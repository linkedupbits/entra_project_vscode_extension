import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth/authService';
import { Connection } from './types';
import {
  getApplication,
  listFederatedIdentityCredentials,
  getServicePrincipalByAppId,
  getResourceApplicationPermissions,
} from '../graph/graphClient';
import { loadApplicationPreview } from './tenantApplicationPreview';
import { downloadApplicationToProject } from './downloadApplicationToProject';
import { ApplicationStore } from '../applications/applicationStore';
import { emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from '../applications/types';

vi.mock('../graph/graphClient', () => ({
  getApplication: vi.fn(),
  listFederatedIdentityCredentials: vi.fn(),
  getServicePrincipalByAppId: vi.fn(),
  getResourceApplicationPermissions: vi.fn(),
}));
vi.mock('../workspacePaths', () => ({ getApplicationsRootUri: vi.fn() }));
import { getApplicationsRootUri } from '../workspacePaths';

const connection: Connection = { name: 'Contoso', tenantId: 't-1', cloud: 'public' };
const auth = { getGraphAccessToken: vi.fn(async () => 'a-token') } as unknown as AuthService;

beforeEach(() => {
  vi.mocked(getApplicationsRootUri).mockReturnValue({ toString: () => '/repo/Applications' } as never);
});

describe('download preserves the scope value for a recognised dependency (preview → download)', () => {
  it('writes the scope value, not the tenant GUID, into resourceAccess[].id', async () => {
    vi.mocked(getApplication).mockResolvedValueOnce({
      displayName: 'Client App',
      signInAudience: 'AzureADMyOrg',
      requiredResourceAccess: [
        { resourceAppId: '00000003-0000-0000-c000-000000000000', resourceAccess: [{ id: 'graph-guid', type: 'Role' }] },
        { resourceAppId: 'sample-api-app-id', resourceAccess: [{ id: 'scope-guid-x', type: 'Scope' }] },
      ],
    });
    vi.mocked(listFederatedIdentityCredentials).mockResolvedValueOnce([]);
    vi.mocked(getServicePrincipalByAppId).mockResolvedValueOnce({
      appId: 'client-app-id',
      appRoleAssignmentRequired: false,
      tags: ['AppName:dev_CX_client-app'],
    });
    vi.mocked(getResourceApplicationPermissions).mockResolvedValueOnce({
      displayName: 'Sample API App',
      permissions: { 'scope-guid-x': { name: 'access_as_user', type: 'Scope' } },
    });

    const data = await loadApplicationPreview(auth, connection, { id: 'obj-1', appId: 'client-app-id', displayName: 'Client App' });

    // sanity: the preview resolved the scope value
    expect(data.resourceApplications['sample-api-app-id'].permissions['scope-guid-x'].name).toBe('access_as_user');

    const saved: unknown[] = [];
    const store = {
      load: vi.fn(async () => ({
        appConfig: emptyAppConfig(),
        application: emptyApplicationFields(),
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      })),
      existingTemplateFiles: vi.fn(async () => ({ application: false, federatedCredentials: false, servicePrincipal: false })),
      save: vi.fn(async (_uri: unknown, files: unknown) => {
        saved.push(files);
      }),
    } as unknown as ApplicationStore;

    const result = await downloadApplicationToProject(
      store,
      { appName: 'client-app', environment: 'dev', businessUnit: 'CX' },
      data,
      connection
    );

    expect(result.kind).toBe('ok');
    const files = saved[0] as { appConfig: { Dependencies: unknown }; application: { requiredPermissions: unknown[] } };
    expect(files.appConfig.Dependencies).toEqual({ SampleAPIApp: { AppName: 'Sample API App' } });
    expect(files.application.requiredPermissions).toEqual([
      { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'graph-guid', type: 'Role' },
      { resourceAppId: '{{ dependency_refs.SampleAPIApp.applicationId }}', id: 'access_as_user', type: 'Scope' },
    ]);
  });
});
