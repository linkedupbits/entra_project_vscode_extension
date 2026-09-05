import { describe, it, expect } from 'vitest';
import * as YAML from 'yaml';
import { buildApplicationDocumentText, parseApplicationDocumentText } from './applicationDocumentContent';
import { ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from './types';

const sampleFiles: ApplicationFiles = {
  appConfig: {
    application_name: 'sample-web-app',
    business_unit: 'Customer Experience',
    Variables: { owner_email: 'team@example.com' },
    Environments: [
      { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev' },
    ],
    Dependencies: {},
  },
  application: {
    displayName: 'Sample Web App (Dev)',
    signInAudience: 'AzureADMyOrg',
    redirectUris: ['https://dev.example.com/signin-oidc'],
    requiredPermissions: [
      { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' },
    ],
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

describe('buildApplicationDocumentText', () => {
  it('builds one YAML document with a top-level key per file', () => {
    const text = buildApplicationDocumentText(sampleFiles);
    const parsed = YAML.parse(text);

    expect(Object.keys(parsed)).toEqual(['AppConfig', 'Application', 'FederatedCredentials', 'ServicePrincipal']);
    expect(parsed.AppConfig).toEqual(sampleFiles.appConfig);
    expect(parsed.FederatedCredentials).toEqual(sampleFiles.federatedCredentials);
  });

  it('serializes Application in the exact Graph JSON shape (grouped requiredResourceAccess, omitted empty sections)', () => {
    const text = buildApplicationDocumentText(sampleFiles);
    const parsed = YAML.parse(text);

    expect(parsed.Application).toEqual({
      displayName: 'Sample Web App (Dev)',
      signInAudience: 'AzureADMyOrg',
      web: { redirectUris: ['https://dev.example.com/signin-oidc'] },
      requiredResourceAccess: [
        {
          resourceAppId: '00000003-0000-0000-c000-000000000000',
          resourceAccess: [{ id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d', type: 'Scope' }],
        },
      ],
    });
  });

  it('serializes ServicePrincipal in the exact Graph JSON shape', () => {
    const text = buildApplicationDocumentText(sampleFiles);
    const parsed = YAML.parse(text);

    expect(parsed.ServicePrincipal).toEqual({
      appId: '{{ application.appId }}',
      appRoleAssignmentRequired: true,
      tags: ['WindowsAzureActiveDirectoryIntegratedApp'],
    });
  });

  it('omits web/requiredResourceAccess/tags entirely when empty, matching ApplicationStore.save()', () => {
    const bareFiles: ApplicationFiles = {
      appConfig: emptyAppConfig(),
      application: emptyApplicationFields(),
      federatedCredentials: [],
      servicePrincipal: emptyServicePrincipalFields(),
    };
    const text = buildApplicationDocumentText(bareFiles);
    const parsed = YAML.parse(text);

    expect(parsed.Application).toEqual({ displayName: '', signInAudience: 'AzureADMyOrg' });
    expect(parsed.ServicePrincipal).toEqual({ appId: '', appRoleAssignmentRequired: false });
  });
});

describe('parseApplicationDocumentText', () => {
  it('round-trips a document built by buildApplicationDocumentText back to the original ApplicationFiles', () => {
    const text = buildApplicationDocumentText(sampleFiles);

    const result = parseApplicationDocumentText(text);

    expect(result).toEqual({ kind: 'ok', files: sampleFiles });
  });

  it('reports a parse error for text that is not valid YAML', () => {
    const result = parseApplicationDocumentText('AppConfig: [this is not: valid: yaml');

    expect(result.kind).toBe('error');
  });

  it('defaults every section to its empty shape when the document is empty', () => {
    const result = parseApplicationDocumentText('');

    expect(result).toEqual({
      kind: 'ok',
      files: {
        appConfig: emptyAppConfig(),
        application: emptyApplicationFields(),
        federatedCredentials: [],
        servicePrincipal: emptyServicePrincipalFields(),
      },
    });
  });

  it('tolerates a document missing one or more top-level keys, defaulting just those sections', () => {
    const result = parseApplicationDocumentText(YAML.stringify({ AppConfig: sampleFiles.appConfig }));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.files.appConfig).toEqual(sampleFiles.appConfig);
      expect(result.files.application).toEqual(emptyApplicationFields());
      expect(result.files.federatedCredentials).toEqual([]);
      expect(result.files.servicePrincipal).toEqual(emptyServicePrincipalFields());
    }
  });

  it('tolerates a document that parses to a non-object (e.g. a bare scalar or list)', () => {
    const result = parseApplicationDocumentText('- just\n- a\n- list\n');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.files.appConfig).toEqual(emptyAppConfig());
    }
  });
});
