import { describe, it, expect, vi } from 'vitest';
import { AuthService } from '../auth/authService';
import { Connection } from './types';
import {
  GraphApplication,
  getApplication,
  listFederatedIdentityCredentials,
  getServicePrincipalByAppId,
  getResourceApplicationPermissions,
} from '../graph/graphClient';
import { MICROSOFT_GRAPH_APP_ID } from '../graph/wellKnownPermissions';
import { loadApplicationPreview } from './tenantApplicationPreview';

vi.mock('../graph/graphClient', () => ({
  getApplication: vi.fn(),
  listFederatedIdentityCredentials: vi.fn(),
  getServicePrincipalByAppId: vi.fn(),
  getResourceApplicationPermissions: vi.fn(),
}));

const connection: Connection = { name: 'Contoso', tenantId: 't-1', cloud: 'public' };
const application: GraphApplication = { id: 'obj-1', appId: 'app-1', displayName: 'My App' };

function fakeAuth(accessToken: (() => Promise<string>) | (() => never) = async () => 'a-token'): AuthService {
  return { getGraphAccessToken: vi.fn(accessToken) } as unknown as AuthService;
}

describe('loadApplicationPreview', () => {
  it('rejects outright when acquiring an access token fails', async () => {
    const auth = fakeAuth(() => {
      throw new Error('Not connected to "Contoso".');
    });

    await expect(loadApplicationPreview(auth, connection, application)).rejects.toThrow(/Not connected/);
    expect(getApplication).not.toHaveBeenCalled();
  });

  it('fetches and normalizes all three sections when everything succeeds', async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({
      displayName: 'My App',
      signInAudience: 'AzureADMyOrg',
      web: { redirectUris: ['https://a.example.com'] },
    });
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([
      { name: 'dev-deploy', issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:x', audiences: ['api://AzureADTokenExchange'], description: '' },
    ]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce({ appId: 'app-1', appRoleAssignmentRequired: true, tags: ['a-tag'] });

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.application).toEqual({
      kind: 'ok',
      value: {
        displayName: 'My App',
        signInAudience: 'AzureADMyOrg',
        redirectUris: ['https://a.example.com'],
        requiredPermissions: [],
        oauth2PermissionScopes: [],
      },
    });
    expect(result.federatedCredentials).toEqual({
      kind: 'ok',
      value: [
        {
          name: 'dev-deploy',
          issuer: 'https://token.actions.githubusercontent.com',
          subject: 'repo:x',
          audiences: ['api://AzureADTokenExchange'],
          description: '',
        },
      ],
    });
    expect(result.servicePrincipal).toEqual({
      kind: 'ok',
      value: { appId: 'app-1', appRoleAssignmentRequired: true, tags: ['a-tag'] },
    });
  });

  it("captures the raw application's publisherDomain field alongside the normalized fields", async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({ displayName: 'My App', publisherDomain: 'contoso.onmicrosoft.com' });
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.applicationPublisherDomain).toBe('contoso.onmicrosoft.com');
  });

  it('defaults applicationPublisherDomain to an empty string when the field is absent', async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({ displayName: 'My App' });
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.applicationPublisherDomain).toBe('');
  });

  it('defaults applicationPublisherDomain to an empty string when the application fetch itself failed', async () => {
    vi.mocked(getApplication).mockRejectedValueOnce(new Error('boom'));
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.applicationPublisherDomain).toBe('');
  });

  it('normalizes a missing service principal (undefined) to empty defaults rather than erroring', async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({});
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.servicePrincipal).toEqual({
      kind: 'ok',
      value: { appId: '', appRoleAssignmentRequired: false, tags: [] },
    });
  });

  it("reports a failing section's own error without affecting the other two", async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({ displayName: 'My App' });
    vi.mocked(listFederatedIdentityCredentials).mockRejectedValueOnce(new Error('Graph returned 403 Forbidden'));
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce({ appId: 'app-1' });

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.application.kind).toBe('ok');
    expect(result.federatedCredentials).toEqual({ kind: 'error', message: 'Graph returned 403 Forbidden' });
    expect(result.servicePrincipal.kind).toBe('ok');
  });

  it('reports a non-Error rejection reason by stringifying it', async () => {
    vi.mocked(getApplication).mockRejectedValueOnce('a plain string failure');
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    const result = await loadApplicationPreview(fakeAuth(), connection, application);

    expect(result.application).toEqual({ kind: 'error', message: 'a plain string failure' });
  });

  it('passes the connection cloud and application IDs through to each Graph call', async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({});
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

    await loadApplicationPreview(fakeAuth(), connection, application);

    expect(getApplication).toHaveBeenCalledWith('a-token', 'public', 'obj-1');
    expect(listFederatedIdentityCredentials).toHaveBeenCalledWith('a-token', 'public', 'obj-1');
    expect(getServicePrincipalByAppId).toHaveBeenCalledWith('a-token', 'public', 'app-1');
  });

  describe('resourceApplications', () => {
    it('resolves Microsoft Graph from the checked-in catalogue, without a live lookup', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({
        requiredResourceAccess: [
          { resourceAppId: MICROSOFT_GRAPH_APP_ID, resourceAccess: [{ id: '7ab1d382-f21e-4acd-a863-ba3e13f7da61', type: 'Role' }] },
        ],
      });
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(result.resourceApplications[MICROSOFT_GRAPH_APP_ID]).toEqual({
        displayName: 'Microsoft Graph',
        permissions: expect.objectContaining({
          '7ab1d382-f21e-4acd-a863-ba3e13f7da61': { name: 'Directory.Read.All', type: 'Role' },
        }),
      });
      expect(getResourceApplicationPermissions).not.toHaveBeenCalled();
    });

    it('resolves an unrecognised resourceAppId via a live lookup', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({
        requiredResourceAccess: [{ resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-1', type: 'Scope' }] }],
      });
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);
      vi.mocked(getResourceApplicationPermissions).mockResolvedValueOnce({
        displayName: 'Other API',
        permissions: { 'perm-1': { name: 'Data.Read', type: 'Scope' } },
      });

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(getResourceApplicationPermissions).toHaveBeenCalledWith('a-token', 'public', 'other-api');
      expect(result.resourceApplications['other-api']).toEqual({
        displayName: 'Other API',
        permissions: { 'perm-1': { name: 'Data.Read', type: 'Scope' } },
      });
    });

    it('looks up each distinct resourceAppId only once, even if referenced by multiple permission rows', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({
        requiredResourceAccess: [
          {
            resourceAppId: 'other-api',
            resourceAccess: [
              { id: 'perm-1', type: 'Scope' },
              { id: 'perm-2', type: 'Scope' },
            ],
          },
        ],
      });
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);
      vi.mocked(getResourceApplicationPermissions).mockResolvedValueOnce({ displayName: 'Other API', permissions: {} });

      await loadApplicationPreview(fakeAuth(), connection, application);

      expect(getResourceApplicationPermissions).toHaveBeenCalledTimes(1);
    });

    it('omits a resource from the result when its live lookup fails, without failing the whole preview', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({
        requiredResourceAccess: [{ resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-1', type: 'Scope' }] }],
      });
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);
      vi.mocked(getResourceApplicationPermissions).mockRejectedValueOnce(new Error('403 Forbidden'));

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(result.resourceApplications).toEqual({});
      expect(result.application.kind).toBe('ok');
    });

    it('omits a resource from the result when its live lookup resolves to undefined (no Service Principal)', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({
        requiredResourceAccess: [{ resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-1', type: 'Scope' }] }],
      });
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);
      vi.mocked(getResourceApplicationPermissions).mockResolvedValueOnce(undefined);

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(result.resourceApplications).toEqual({});
    });

    it('is empty, with no lookups attempted, when the application section itself failed to load', async () => {
      vi.mocked(getApplication).mockRejectedValueOnce(new Error('boom'));
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(result.resourceApplications).toEqual({});
      expect(getResourceApplicationPermissions).not.toHaveBeenCalled();
    });

    it('is empty, with no lookups attempted, when there are no required permissions at all', async () => {
      vi.mocked(getApplication).mockResolvedValueOnce({});
      vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
      vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce(undefined);

      const result = await loadApplicationPreview(fakeAuth(), connection, application);

      expect(result.resourceApplications).toEqual({});
      expect(getResourceApplicationPermissions).not.toHaveBeenCalled();
    });
  });
});
