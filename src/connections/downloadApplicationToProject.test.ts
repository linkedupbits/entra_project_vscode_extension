import { describe, it, expect, vi } from 'vitest';
import { ApplicationStore } from '../applications/applicationStore';
import { AppConfig, ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from '../applications/types';
import { TenantApplicationIdentity } from './tenantApplicationIdentity';
import { ApplicationPreviewData } from './tenantApplicationPreview';
import { downloadApplicationToProject } from './downloadApplicationToProject';

vi.mock('../workspacePaths', () => ({
  getApplicationsRootUri: vi.fn(),
}));

import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/applications', toString: () => '/repo/entra/applications' };
const folderUri = { fsPath: '/repo/entra/applications/sample-web-app', toString: () => '/repo/entra/applications/sample-web-app' };

const identity: TenantApplicationIdentity = { environment: 'dev', businessUnit: 'Customer Experience', appName: 'sample-web-app' };

function okData(overrides: Partial<ApplicationPreviewData> = {}): ApplicationPreviewData {
  return {
    application: {
      kind: 'ok',
      value: { displayName: 'My App', signInAudience: 'AzureADMyOrg', redirectUris: [], requiredPermissions: [] },
    },
    federatedCredentials: { kind: 'ok', value: [] },
    servicePrincipal: { kind: 'ok', value: { appId: 'app-1', appRoleAssignmentRequired: false, tags: ['AppName:dev_Customer Experience_sample-web-app'] } },
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

    const result = await downloadApplicationToProject(store, identity, okData());

    expect(result).toEqual({ kind: 'noWorkspace' });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns incompletePreview when any section failed to load, and does not write anything', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    const result = await downloadApplicationToProject(
      store,
      identity,
      okData({ federatedCredentials: { kind: 'error', message: 'boom' } })
    );

    expect(result).toEqual({ kind: 'incompletePreview' });
    expect(save).not.toHaveBeenCalled();
  });

  it('creates a new application folder with AppConfig seeded from the identity when nothing exists yet', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    const result = await downloadApplicationToProject(store, identity, okData());

    expect(result.kind).toBe('ok');
    expect((result as { kind: 'ok'; folderUri: { fsPath: string } }).folderUri.fsPath).toBe(folderUri.fsPath);
    const [savedFolderUri, savedFiles] = save.mock.calls[0];
    expect((savedFolderUri as { fsPath: string }).fsPath).toBe('/repo/entra/applications/sample-web-app');
    expect(savedFiles.appConfig.application_name).toBe('sample-web-app');
    expect(savedFiles.appConfig.business_unit).toBe('Customer Experience');
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'dev', publisherDomain: '', tenancy_type: '', environment_code: 'dev' },
    ]);
  });

  it('writes all three template files verbatim from the fetched data when none exist yet', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();
    const data = okData();

    await downloadApplicationToProject(store, identity, data);

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.application).toEqual((data.application as { kind: 'ok'; value: ApplicationFiles['application'] }).value);
    expect(savedFiles.servicePrincipal).toEqual(
      (data.servicePrincipal as { kind: 'ok'; value: ApplicationFiles['servicePrincipal'] }).value
    );
  });

  it('does not overwrite an existing Application.yaml.j2 template', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingApplication: ApplicationFiles['application'] = {
      displayName: '{{ application_name }} ({{ name }})',
      signInAudience: 'AzureADMyOrg',
      redirectUris: [],
      requiredPermissions: [],
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

    await downloadApplicationToProject(store, identity, okData());

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

    await downloadApplicationToProject(store, identity, okData());

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

    await downloadApplicationToProject(store, identity, okData());

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.business_unit).toBe('Hand-set Unit');
  });

  it('does not duplicate an Environments entry that already has this environment_code', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = {
      ...emptyAppConfig(),
      application_name: 'sample-web-app',
      Environments: [{ name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev' }],
    };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData());

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev' },
    ]);
  });

  it('appends a new Environments entry alongside existing ones for a different environment_code', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const existingAppConfig: AppConfig = {
      ...emptyAppConfig(),
      application_name: 'sample-web-app',
      Environments: [{ name: 'Test', publisherDomain: 'contoso-test.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'test' }],
    };
    const { store, save } = fakeStore({
      appConfig: existingAppConfig,
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    });

    await downloadApplicationToProject(store, identity, okData());

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.Environments).toEqual([
      { name: 'Test', publisherDomain: 'contoso-test.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'test' },
      { name: 'dev', publisherDomain: '', tenancy_type: '', environment_code: 'dev' },
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

    await downloadApplicationToProject(store, identity, okData());

    const [, savedFiles] = save.mock.calls[0];
    expect(savedFiles.appConfig.application_name).toBe('Hand-set Name');
  });
});
