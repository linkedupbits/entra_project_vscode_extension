import { describe, it, expect, vi } from 'vitest';
import { ApplicationStore } from '../applications/applicationStore';
import { AppConfig, ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from '../applications/types';
import { Connection } from './types';
import { TenantApplicationIdentity } from './tenantApplicationIdentity';
import { ApplicationPreviewData } from './tenantApplicationPreview';
import { downloadApplicationToProject } from './downloadApplicationToProject';

vi.mock('../workspacePaths', () => ({
  getApplicationsRootUri: vi.fn(),
}));

import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/Applications', toString: () => '/repo/entra/Applications' };
const folderUri = { fsPath: '/repo/entra/Applications/sample-web-app', toString: () => '/repo/entra/Applications/sample-web-app' };

const identity: TenantApplicationIdentity = { environment: 'dev', businessUnit: 'Customer Experience', appName: 'sample-web-app' };
const connection: Connection = { name: 'Contoso', tenantId: 't-1', cloud: 'public' };

function okData(overrides: Partial<ApplicationPreviewData> = {}): ApplicationPreviewData {
  return {
    application: {
      kind: 'ok',
      value: {
        displayName: 'My App',
        signInAudience: 'AzureADMyOrg',
        requiredPermissions: [],
        oauth2PermissionScopes: [],
      },
    },
    applicationPublisherDomain: '',
    webRedirectUris: [],
    publicClientRedirectUris: [],
    spaRedirectUris: [],
    resourceApplications: {},
    federatedCredentials: { kind: 'ok', value: [] },
    servicePrincipal: {
      kind: 'ok',
      value: { appId: 'app-1', appRoleAssignmentRequired: false, tags: ['AppName:dev_Customer Experience_sample-web-app'] },
    },
    ...overrides,
  };
}

function fakeStore(
  existing: ApplicationFiles = {
    appConfig: emptyAppConfig(),
    application: emptyApplicationFields(),
    federatedCredentials: [],
    servicePrincipal: emptyServicePrincipalFields(),
  },
  existingTemplates = { application: false, federatedCredentials: false, servicePrincipal: false }
) {
  const save = vi.fn(async (_folderUri: unknown, _files: ApplicationFiles) => {});
  const store = {
    load: vi.fn(async () => existing),
    existingTemplateFiles: vi.fn(async () => existingTemplates),
    save,
  } as unknown as ApplicationStore;
  return { store, save };
}

describe('downloadApplicationToProject', () => {
  it('returns noWorkspace when there is no workspace open', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(undefined);
    const { store, save } = fakeStore();

    const result = await downloadApplicationToProject(store, identity, okData(), connection);

    expect(result).toEqual({ kind: 'noWorkspace' });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns incompletePreview when any section failed to load, and does not write anything', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    const result = await downloadApplicationToProject(
      store,
      identity,
      okData({ federatedCredentials: { kind: 'error', message: 'boom' } }),
      connection
    );

    expect(result).toEqual({ kind: 'incompletePreview' });
    expect(save).not.toHaveBeenCalled();
  });

  it('creates a new application folder with AppConfig seeded from the identity when nothing exists yet', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    const result = await downloadApplicationToProject(store, identity, okData(), connection);

    expect(result.kind).toBe('ok');
    expect((result as { kind: 'ok'; folderUri: { fsPath: string } }).folderUri.fsPath).toBe(folderUri.fsPath);
    const [savedFolderUri, savedFiles] = save.mock.calls[0];
    expect((savedFolderUri as { fsPath: string }).fsPath).toBe('/repo/entra/Applications/sample-web-app');
    expect(savedFiles.appConfig.application_name).toBe('sample-web-app');
    expect(savedFiles.appConfig.business_unit).toBe('Customer Experience');
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'dev', publisherDomain: '', tenancy_type: '', environment_code: 'dev', Variables: {} },
    ]);
  });

  it("seeds a new Environments entry's Variables with the tenant application's redirect URIs", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    await downloadApplicationToProject(
      store,
      identity,
      okData({
        webRedirectUris: ['https://dev.example.com/signin-oidc'],
        publicClientRedirectUris: ['https://login.microsoftonline.com/common/oauth2/nativeclient'],
        spaRedirectUris: ['https://dev.example.com'],
      }),
      connection
    );

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments[0].Variables).toEqual({
      web_redirectUris: ['https://dev.example.com/signin-oidc'],
      publicClient_redirectURIs: ['https://login.microsoftonline.com/common/oauth2/nativeclient'],
      spa_redirectURIs: ['https://dev.example.com'],
    });
  });

  it('writes the Application file verbatim from the fetched data when none exists yet', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData();

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.application).toEqual((data.application as { kind: 'ok'; value: ApplicationFiles['application'] }).value);
  });

  it('derives AppConfig Dependencies from non-Graph required permissions, rewriting resourceAppId and the GUID to the scope value', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData({
      application: {
        kind: 'ok',
        value: {
          displayName: 'My App',
          signInAudience: 'AzureADMyOrg',
          requiredPermissions: [
            { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'graph-perm', type: 'Role' },
            { resourceAppId: 'api-app-id', id: 'a1b2c3-scope-guid', type: 'Scope' },
          ],
          oauth2PermissionScopes: [],
        },
      },
      resourceApplications: {
        'api-app-id': {
          displayName: 'Sample API App',
          tags: [],
          permissions: { 'a1b2c3-scope-guid': { name: 'access_as_user', type: 'Scope' } },
        },
      },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Dependencies).toEqual({ SampleAPIApp: { AppName: 'Sample API App' } });
    expect(savedFiles.application.requiredPermissions).toEqual([
      { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'graph-perm', type: 'Role' },
      { resourceAppId: '{{ dependency_refs.SampleAPIApp.applicationId }}', id: 'access_as_user', type: 'Scope' },
    ]);
  });

  it('does not derive dependencies when Application.yaml.j2 already exists — existing Dependencies untouched', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingApplication: ApplicationFiles['application'] = {
      displayName: '{{ application_name }}',
      signInAudience: 'AzureADMyOrg',
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    };
    const { store, save } = fakeStore(
      {
        appConfig: { ...emptyAppConfig(), Dependencies: { HandAuthored: { AppName: 'hand-authored' } } },
        application: existingApplication,
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      },
      { application: true, federatedCredentials: false, servicePrincipal: false }
    );
    const data = okData({
      application: {
        kind: 'ok',
        value: {
          displayName: 'My App',
          signInAudience: 'AzureADMyOrg',
          requiredPermissions: [{ resourceAppId: 'api-app-id', id: 'access_as_user', type: 'Scope' }],
          oauth2PermissionScopes: [],
        },
      },
      resourceApplications: { 'api-app-id': { displayName: 'Sample API App', tags: [], permissions: {} } },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Dependencies).toEqual({ HandAuthored: { AppName: 'hand-authored' } });
    expect(savedFiles.application).toEqual(existingApplication);
  });

  it("writes the Service Principal's non-generated fields verbatim, stripping its generated tags", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData({
      servicePrincipal: {
        kind: 'ok',
        value: {
          appId: '{{ application.appId }}',
          appRoleAssignmentRequired: true,
          tags: ['AppName:dev_Customer Experience_sample-web-app', 'WindowsAzureActiveDirectoryIntegratedApp'],
        },
      },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.servicePrincipal).toEqual({
      appId: '{{ application.appId }}',
      appRoleAssignmentRequired: true,
      tags: ['WindowsAzureActiveDirectoryIntegratedApp'],
    });
  });

  it('strips all four kinds of generated tags (three prefixes plus the bare app name)', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData({
      servicePrincipal: {
        kind: 'ok',
        value: {
          appId: 'app-1',
          appRoleAssignmentRequired: false,
          tags: [
            'AppName:dev_Customer Experience_sample-web-app',
            'Environment:dev',
            'sample-web-app',
            'BusinessUnit:Customer Experience',
            'a-real-custom-tag',
          ],
        },
      },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.servicePrincipal.tags).toEqual(['a-real-custom-tag']);
  });

  it("does not enrich a new Environments entry from the connection when there's no Environment: tag", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData({
      applicationPublisherDomain: 'contoso.onmicrosoft.com',
      servicePrincipal: {
        kind: 'ok',
        value: { appId: 'app-1', appRoleAssignmentRequired: false, tags: ['AppName:dev_Customer Experience_sample-web-app'] },
      },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'dev', publisherDomain: '', tenancy_type: '', environment_code: 'dev', Variables: {} },
    ]);
  });

  it('enriches a new Environments entry with publisherDomain/tenancy_type from the connection when there is an Environment: tag', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData({
      applicationPublisherDomain: 'contoso.onmicrosoft.com',
      servicePrincipal: {
        kind: 'ok',
        value: {
          appId: 'app-1',
          appRoleAssignmentRequired: false,
          tags: ['AppName:dev_Customer Experience_sample-web-app', 'Environment:dev'],
        },
      },
    });

    await downloadApplicationToProject(store, identity, data, connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'dev', publisherDomain: 'contoso.onmicrosoft.com', tenancy_type: 'workforce', environment_code: 'dev', Variables: {} },
    ]);
  });

  it("uses 'ciam' as the tenancy_type for an externalId connection when enriching from the connection", async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const externalIdConnection: Connection = { ...connection, tenantKind: 'externalId' };
    const data = okData({
      servicePrincipal: {
        kind: 'ok',
        value: {
          appId: 'app-1',
          appRoleAssignmentRequired: false,
          tags: ['AppName:dev_Customer Experience_sample-web-app', 'Environment:dev'],
        },
      },
    });

    await downloadApplicationToProject(store, identity, data, externalIdConnection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments[0].tenancy_type).toBe('ciam');
  });

  it('does not overwrite an existing Application.yaml.j2 template', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingApplication: ApplicationFiles['application'] = {
      displayName: '{{ application_name }} ({{ name }})',
      signInAudience: 'AzureADMyOrg',
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    };
    const { store, save } = fakeStore(
      {
        appConfig: emptyAppConfig(),
        application: existingApplication,
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      },
      { application: true, federatedCredentials: false, servicePrincipal: false }
    );

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.application).toEqual(existingApplication);
  });

  it('does not overwrite an existing FederatedCredentials.yaml.j2 or ServicePrincipal.yaml.j2 template', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingFedCreds: ApplicationFiles['federatedCredentials'] = [
      { name: 'x', issuer: 'y', subject: 'z', audiences: [], description: '' },
    ];
    const existingSp: ApplicationFiles['servicePrincipal'] = { appId: '{{ application.appId }}', appRoleAssignmentRequired: true, tags: [] };
    const { store, save } = fakeStore(
      { appConfig: emptyAppConfig(), application: emptyApplicationFields(), federatedCredentials: existingFedCreds, servicePrincipal: existingSp },
      { application: false, federatedCredentials: true, servicePrincipal: true }
    );

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.federatedCredentials).toEqual(existingFedCreds);
    expect(savedFiles.servicePrincipal).toEqual(existingSp);
  });

  it('does not overwrite an existing non-blank business_unit', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = { ...emptyAppConfig(), application_name: 'sample-web-app', business_unit: 'Hand-set Unit' };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.business_unit).toBe('Hand-set Unit');
  });

  it('does not duplicate an Environments entry that already has this environment_code', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = {
      ...emptyAppConfig(),
      application_name: 'sample-web-app',
      Environments: [
        { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev', Variables: {} },
      ],
    };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev', Variables: {} },
    ]);
  });

  it('appends a new Environments entry alongside existing ones for a different environment_code', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = {
      ...emptyAppConfig(),
      application_name: 'sample-web-app',
      Environments: [
        { name: 'Test', publisherDomain: 'contoso-test.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'test', Variables: {} },
      ],
    };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'Test', publisherDomain: 'contoso-test.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'test', Variables: {} },
      { name: 'dev', publisherDomain: '', tenancy_type: '', environment_code: 'dev', Variables: {} },
    ]);
  });

  it('preserves an existing application_name rather than overwriting it with the identity', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = { ...emptyAppConfig(), application_name: 'Hand-set Name' };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData(), connection);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.application_name).toBe('Hand-set Name');
  });
});
