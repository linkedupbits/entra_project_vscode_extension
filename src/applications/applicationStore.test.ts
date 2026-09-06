import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { FileSystemError } from '../test/vscodeMock';
import { ApplicationStore } from './applicationStore';
import { AppConfig, ApplicationFiles } from './types';

const folderUri = { fsPath: '/repo/entra/Applications/sample-web-app', toString: () => '/repo/entra/Applications/sample-web-app' };

const sampleAppConfig: AppConfig = {
  application_name: 'sample-web-app',
  business_unit: 'Customer Experience',
  Variables: { owner_email: 'team@example.com' },
  Environments: [
    {
      name: 'Dev',
      publisherDomain: 'contoso-dev.onmicrosoft.com',
      tenancy_type: 'ciam',
      environment_code: 'dev',
      // Matches what ApplicationFiles looks like in practice — see buildAppConfigNode's doc comment.
      Variables: { owner_email: 'team@example.com' },
    },
  ],
  Dependencies: { SampleAPIApp: { AppName: 'sample-api' } },
};

const sampleFiles: ApplicationFiles = {
  appConfig: sampleAppConfig,
  application: {
    displayName: 'Sample Web App (Dev)',
    signInAudience: 'AzureADMyOrg',
    requiredPermissions: [
      { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' },
    ],
    oauth2PermissionScopes: [],
  },
  federatedCredentials: [
    {
      name: 'dev-deploy',
      issuer: 'https://token.actions.githubusercontent.com',
      subject: 'repo:contoso/sample-web-app:environment:dev',
      audiences: ['api://AzureADTokenExchange'],
      description: '',
    },
  ],
  servicePrincipal: {
    appId: '{{ application.appId }}',
    appRoleAssignmentRequired: true,
    tags: ['WindowsAzureActiveDirectoryIntegratedApp'],
  },
};

function readFileOnceText(text: string) {
  return Buffer.from(text, 'utf8');
}

describe('ApplicationStore.load', () => {
  it('returns empty/default structures when nothing exists yet', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(FileSystemError.FileNotFound());

    const files = await new ApplicationStore().load(folderUri as never);

    expect(files.appConfig).toEqual({
      application_name: '',
      business_unit: '',
      Variables: {},
      Environments: [],
      Dependencies: {},
    });
    expect(files.application).toEqual({
      displayName: '',
      signInAudience: 'AzureADMyOrg',
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    });
    expect(files.federatedCredentials).toEqual([]);
    expect(files.servicePrincipal).toEqual({ appId: '', appRoleAssignmentRequired: false, tags: [] });
  });

  it('rethrows a non-FileNotFound error reading AppConfig.yaml', async () => {
    const boom = new Error('disk on fire');
    vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(boom);

    await expect(new ApplicationStore().load(folderUri as never)).rejects.toBe(boom);
  });

  it('rethrows a non-FileNotFound error reading a template file', async () => {
    const boom = new Error('disk on fire');
    vi.mocked(vscode.workspace.fs.readFile)
      .mockRejectedValueOnce(FileSystemError.FileNotFound()) // AppConfig.yaml
      .mockRejectedValueOnce(boom); // Application.yaml.j2

    await expect(new ApplicationStore().load(folderUri as never)).rejects.toBe(boom);
  });

  it('parses and flattens/normalizes all four files', async () => {
    vi.mocked(vscode.workspace.fs.readFile)
      .mockResolvedValueOnce(readFileOnceText(YAML.stringify(sampleAppConfig)))
      .mockResolvedValueOnce(
        readFileOnceText(
          YAML.stringify({
            displayName: sampleFiles.application.displayName,
            signInAudience: sampleFiles.application.signInAudience,
            requiredResourceAccess: [
              {
                resourceAppId: '00000003-0000-0000-c000-000000000000',
                resourceAccess: [{ id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' }],
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(readFileOnceText(YAML.stringify(sampleFiles.federatedCredentials)))
      .mockResolvedValueOnce(readFileOnceText(YAML.stringify(sampleFiles.servicePrincipal)));

    const files = await new ApplicationStore().load(folderUri as never);

    expect(files).toEqual(sampleFiles);
  });
});

describe('ApplicationStore.save', () => {
  it('creates the application folder and writes all four files as YAML', async () => {
    await new ApplicationStore().save(folderUri as never, sampleFiles);

    expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(folderUri);
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(4);

    const writes = new Map(
      vi.mocked(vscode.workspace.fs.writeFile).mock.calls.map(([uri, bytes]) => [
        (uri as unknown as { fsPath: string }).fsPath,
        Buffer.from(bytes as Uint8Array).toString('utf8'),
      ])
    );

    expect(
      YAML.parse(writes.get('/repo/entra/Applications/sample-web-app/AppConfig.yaml')!, { merge: true })
    ).toEqual(sampleAppConfig);

    expect(YAML.parse(writes.get('/repo/entra/Applications/sample-web-app/Application.yaml.j2')!)).toEqual({
      displayName: 'Sample Web App (Dev)',
      signInAudience: 'AzureADMyOrg',
      requiredResourceAccess: [
        {
          resourceAppId: '00000003-0000-0000-c000-000000000000',
          resourceAccess: [{ id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' }],
        },
      ],
    });

    expect(YAML.parse(writes.get('/repo/entra/Applications/sample-web-app/FederatedCredentials.yaml.j2')!)).toEqual(
      sampleFiles.federatedCredentials
    );

    expect(YAML.parse(writes.get('/repo/entra/Applications/sample-web-app/ServicePrincipal.yaml.j2')!)).toEqual({
      appId: '{{ application.appId }}',
      appRoleAssignmentRequired: true,
      tags: ['WindowsAzureActiveDirectoryIntegratedApp'],
    });
  });

  it('omits requiredResourceAccess and api entirely when there is nothing to put in them', async () => {
    await new ApplicationStore().save(folderUri as never, {
      ...sampleFiles,
      application: {
        displayName: 'Bare',
        signInAudience: 'AzureADMyOrg',
          requiredPermissions: [],
        oauth2PermissionScopes: [],
      },
    });

    const [, bytes] = vi
      .mocked(vscode.workspace.fs.writeFile)
      .mock.calls.find(([uri]) => (uri as unknown as { fsPath: string }).fsPath.endsWith('Application.yaml.j2'))!;
    const parsed = YAML.parse(Buffer.from(bytes as Uint8Array).toString('utf8'));

    expect(parsed).toEqual({ displayName: 'Bare', signInAudience: 'AzureADMyOrg' });
  });

  it('groups multiple required-permission rows sharing a resourceAppId into one entry', async () => {
    await new ApplicationStore().save(folderUri as never, {
      ...sampleFiles,
      application: {
        displayName: '',
        signInAudience: 'AzureADMyOrg',
          requiredPermissions: [
          { resourceAppId: 'graph', id: 'perm-a', type: 'Scope' },
          { resourceAppId: 'graph', id: 'perm-b', type: 'Role' },
          { resourceAppId: 'other-api', id: 'perm-c', type: 'Scope' },
        ],
        oauth2PermissionScopes: [],
      },
    });

    const [, bytes] = vi
      .mocked(vscode.workspace.fs.writeFile)
      .mock.calls.find(([uri]) => (uri as unknown as { fsPath: string }).fsPath.endsWith('Application.yaml.j2'))!;
    const parsed = YAML.parse(Buffer.from(bytes as Uint8Array).toString('utf8'));

    expect(parsed.requiredResourceAccess).toEqual([
      {
        resourceAppId: 'graph',
        resourceAccess: [
          { id: 'perm-a', type: 'Scope' },
          { id: 'perm-b', type: 'Role' },
        ],
      },
      { resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-c', type: 'Scope' }] },
    ]);
  });

  it('omits tags entirely when there are none', async () => {
    await new ApplicationStore().save(folderUri as never, {
      ...sampleFiles,
      servicePrincipal: { appId: 'x', appRoleAssignmentRequired: false, tags: [] },
    });

    const [, bytes] = vi
      .mocked(vscode.workspace.fs.writeFile)
      .mock.calls.find(([uri]) => (uri as unknown as { fsPath: string }).fsPath.endsWith('ServicePrincipal.yaml.j2'))!;
    const parsed = YAML.parse(Buffer.from(bytes as Uint8Array).toString('utf8'));

    expect(parsed).toEqual({ appId: 'x', appRoleAssignmentRequired: false });
  });
});

describe('ApplicationStore.existingTemplateFiles', () => {
  it('reports all three as absent when the folder does not exist yet', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValueOnce(FileSystemError.FileNotFound());

    const result = await new ApplicationStore().existingTemplateFiles(folderUri as never);

    expect(result).toEqual({ application: false, federatedCredentials: false, servicePrincipal: false });
  });

  it('rethrows a non-FileNotFound error', async () => {
    const boom = new Error('disk on fire');
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValueOnce(boom);

    await expect(new ApplicationStore().existingTemplateFiles(folderUri as never)).rejects.toBe(boom);
  });

  it('reports exactly which template files are present, ignoring AppConfig.yaml and other files', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([
      ['AppConfig.yaml', vscode.FileType.File],
      ['Application.yaml.j2', vscode.FileType.File],
      ['notes.txt', vscode.FileType.File],
    ] as never);

    const result = await new ApplicationStore().existingTemplateFiles(folderUri as never);

    expect(result).toEqual({ application: true, federatedCredentials: false, servicePrincipal: false });
  });
});
