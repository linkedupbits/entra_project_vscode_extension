import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { buildPermissionOptionsByResourceAppId } from './permissionIdOptions';
import { MICROSOFT_GRAPH_APP_ID, buildDependencyReference } from './resourceAppIdReference';
import { ApplicationStore } from './applicationStore';
import { ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from './types';

vi.mock('../workspacePaths', () => ({
  getApplicationsRootUri: vi.fn(),
}));

import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/Applications', toString: () => '/repo/entra/Applications' };

function fakeStore(filesByAppName: Record<string, ApplicationFiles>) {
  return {
    load: vi.fn(async (folderUri: vscode.Uri) => {
      const name = folderUri.toString().split('/').pop()!;
      return (
        filesByAppName[name] ?? {
          appConfig: emptyAppConfig(),
          application: emptyApplicationFields(),
          federatedCredentials: [],
          servicePrincipal: emptyServicePrincipalFields(),
        }
      );
    }),
  } as unknown as ApplicationStore;
}

describe('buildPermissionOptionsByResourceAppId', () => {
  it('includes Microsoft Graph options from the well-known catalogue, including a well-known permission', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(undefined);

    const result = await buildPermissionOptionsByResourceAppId(fakeStore({}), {});

    const graphOptions = result[MICROSOFT_GRAPH_APP_ID];
    expect(graphOptions.length).toBeGreaterThan(100);
    expect(graphOptions).toContainEqual({ id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', label: 'User.Read', type: 'Scope' });
  });

  it('returns no options for a dependency when there is no applications root', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(undefined);

    const result = await buildPermissionOptionsByResourceAppId(fakeStore({}), { SampleAPIApp: { AppName: 'sample-api' } });

    expect(result[buildDependencyReference('SampleAPIApp')]).toBeUndefined();
  });

  it("looks up a dependency's own exposed oauth2PermissionScopes as its Permission ID options, keyed by the scope's value rather than its GUID", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const store = fakeStore({
      'sample-api': {
        appConfig: emptyAppConfig(),
        application: {
          ...emptyApplicationFields(),
          oauth2PermissionScopes: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              value: 'access_as_user',
              type: 'User',
              adminConsentDisplayName: '',
              adminConsentDescription: '',
              userConsentDisplayName: '',
              userConsentDescription: '',
              isEnabled: true,
            },
          ],
        },
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      },
    });

    const result = await buildPermissionOptionsByResourceAppId(store, { SampleAPIApp: { AppName: 'sample-api' } });

    expect(result[buildDependencyReference('SampleAPIApp')]).toEqual([
      { id: 'access_as_user', label: 'access_as_user', type: 'Scope' },
    ]);
  });

  it('omits a dependency with no exposed scopes from the result entirely', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const store = fakeStore({}); // load() falls back to empty defaults for any folder name

    const result = await buildPermissionOptionsByResourceAppId(store, { SampleAPIApp: { AppName: 'sample-api' } });

    expect(result[buildDependencyReference('SampleAPIApp')]).toBeUndefined();
  });

  it('skips an exposed scope with a blank value, since it has no usable label', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const store = fakeStore({
      'sample-api': {
        appConfig: emptyAppConfig(),
        application: {
          ...emptyApplicationFields(),
          oauth2PermissionScopes: [
            {
              id: 'x',
              value: '',
              type: 'User',
              adminConsentDisplayName: '',
              adminConsentDescription: '',
              userConsentDisplayName: '',
              userConsentDescription: '',
              isEnabled: true,
            },
          ],
        },
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      },
    });

    const result = await buildPermissionOptionsByResourceAppId(store, { SampleAPIApp: { AppName: 'sample-api' } });

    expect(result[buildDependencyReference('SampleAPIApp')]).toBeUndefined();
  });

  it('skips a dependency row with no application selected', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const store = fakeStore({});

    await buildPermissionOptionsByResourceAppId(store, { SampleAPIApp: { AppName: '' } });

    expect(store.load).not.toHaveBeenCalled();
  });

  it("isolates a dependency whose file fails to load, without breaking the rest of the result", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const store = {
      load: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ApplicationStore;

    const result = await buildPermissionOptionsByResourceAppId(store, { SampleAPIApp: { AppName: 'sample-api' } });

    expect(result[buildDependencyReference('SampleAPIApp')]).toBeUndefined();
    expect(result[MICROSOFT_GRAPH_APP_ID].length).toBeGreaterThan(0);
  });
});
