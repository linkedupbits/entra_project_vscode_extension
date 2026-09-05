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
      {
        name: 'Dev',
        publisherDomain: 'contoso-dev.onmicrosoft.com',
        tenancy_type: 'ciam',
        environment_code: 'dev',
        // Matches what ApplicationFiles looks like in practice: resolveApplicationSubmit's
        // mergeDefaultVariablesIntoEnvironments always copies the shared Variables above into
        // every environment before this shape is produced — see buildAppConfigNode's doc comment.
        Variables: { owner_email: 'team@example.com' },
      },
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
    oauth2PermissionScopes: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        value: 'access_as_user',
        type: 'User',
        adminConsentDisplayName: 'Access sample-web-app',
        adminConsentDescription: 'Allows the app to access sample-web-app on behalf of the signed-in user.',
        userConsentDisplayName: 'Access sample-web-app',
        userConsentDescription: 'Allows the app to access sample-web-app on your behalf.',
        isEnabled: true,
      },
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
    const parsed = YAML.parse(text, { merge: true });

    expect(Object.keys(parsed)).toEqual(['AppConfig', 'Application', 'FederatedCredentials', 'ServicePrincipal']);
    expect(parsed.AppConfig).toEqual(sampleFiles.appConfig);
    expect(parsed.FederatedCredentials).toEqual(sampleFiles.federatedCredentials);
  });

  it('serializes Application in the exact Graph JSON shape (grouped requiredResourceAccess, omitted empty sections)', () => {
    const text = buildApplicationDocumentText(sampleFiles);
    const parsed = YAML.parse(text, { merge: true });

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
      api: {
        oauth2PermissionScopes: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            adminConsentDescription: 'Allows the app to access sample-web-app on behalf of the signed-in user.',
            adminConsentDisplayName: 'Access sample-web-app',
            isEnabled: true,
            type: 'User',
            userConsentDescription: 'Allows the app to access sample-web-app on your behalf.',
            userConsentDisplayName: 'Access sample-web-app',
            value: 'access_as_user',
          },
        ],
      },
    });
  });

  it('serializes ServicePrincipal in the exact Graph JSON shape', () => {
    const text = buildApplicationDocumentText(sampleFiles);
    const parsed = YAML.parse(text, { merge: true });

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
    const parsed = YAML.parse(text, { merge: true });

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
