import { describe, it, expect } from 'vitest';
import { buildApplicationPreviewHtml } from './applicationPreviewHtml';
import { ApplicationPreviewData } from './tenantApplicationPreview';

function data(overrides: Partial<ApplicationPreviewData> = {}): ApplicationPreviewData {
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
    servicePrincipal: { kind: 'ok', value: { appId: '', appRoleAssignmentRequired: false, tags: [] } },
    ...overrides,
  };
}

describe('buildApplicationPreviewHtml', () => {
  it('renders the parsed unique name from an AppName tag on the service principal', () => {
    const html = buildApplicationPreviewHtml(
      data({
        servicePrincipal: {
          kind: 'ok',
          value: { appId: 'app-1', appRoleAssignmentRequired: false, tags: ['AppName:dev_Customer Experience_sample-web-app'] },
        },
      })
    );
    expect(html).toContain('dev_Customer Experience_sample-web-app');
  });

  it('shows an explicit "not found" state when no AppName tag is present', () => {
    const html = buildApplicationPreviewHtml(data());
    expect(html).toContain('No unique name tag found');
  });

  it('shows the "not found" state when the service principal section itself failed to load', () => {
    const html = buildApplicationPreviewHtml(data({ servicePrincipal: { kind: 'error', message: 'boom' } }));
    expect(html).toContain('No unique name tag found');
  });

  it('renders the application display name and sign-in audience', () => {
    const html = buildApplicationPreviewHtml(data());
    expect(html).toContain('My App');
    expect(html).toContain('AzureADMyOrg');
  });

  it('shows "None" for empty redirect URIs, required permissions, exposed API scopes, and tags', () => {
    const html = buildApplicationPreviewHtml(data());
    expect(html.match(/None/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('lists the three redirect-URI categories and required permissions when present', () => {
    const html = buildApplicationPreviewHtml(
      data({
        webRedirectUris: ['https://a.example.com/signin-oidc'],
        publicClientRedirectUris: ['https://login.microsoftonline.com/common/oauth2/nativeclient'],
        spaRedirectUris: ['https://spa.example.com'],
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [{ resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'perm-1', type: 'Scope' }],
            oauth2PermissionScopes: [],
          },
        },
      })
    );
    expect(html).toContain('Web redirect URIs');
    expect(html).toContain('https://a.example.com/signin-oidc');
    expect(html).toContain('https://login.microsoftonline.com/common/oauth2/nativeclient');
    expect(html).toContain('https://spa.example.com');
    expect(html).toContain('00000003-0000-0000-c000-000000000000');
    expect(html).toContain('perm-1');
  });

  it('renders "Application name : Scope name (App ID : Scope ID)" for a resolved permission', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [
              {
                resourceAppId: '00000003-0000-0000-c000-000000000000',
                id: '7ab1d382-f21e-4acd-a863-ba3e13f7da61',
                type: 'Role',
              },
            ],
            oauth2PermissionScopes: [],
          },
        },
        resourceApplications: {
          '00000003-0000-0000-c000-000000000000': {
            displayName: 'Microsoft Graph',
            tags: [],
            permissions: { '7ab1d382-f21e-4acd-a863-ba3e13f7da61': { name: 'Directory.Read.All', type: 'Role' } },
          },
        },
      })
    );
    expect(html).toContain('Microsoft Graph : Directory.Read.All');
    expect(html).toContain('00000003-0000-0000-c000-000000000000');
    expect(html).toContain('7ab1d382-f21e-4acd-a863-ba3e13f7da61');
  });

  it('falls back to the raw resourceAppId when the resource itself is unrecognised', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [{ resourceAppId: 'some-other-api', id: 'unknown-id', type: 'Scope' }],
            oauth2PermissionScopes: [],
          },
        },
      })
    );
    expect(html).toContain('some-other-api : unknown-id');
  });

  it("falls back to the raw permission id when the resource resolved but doesn't expose that id", () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [{ resourceAppId: 'some-other-api', id: 'unknown-id', type: 'Scope' }],
            oauth2PermissionScopes: [],
          },
        },
        resourceApplications: {
          'some-other-api': { displayName: 'Some Other API', tags: [], permissions: {} },
        },
      })
    );
    expect(html).toContain('Some Other API : unknown-id');
  });

  it('lists a resolved non-Graph resource as a dependency, and omits Microsoft Graph', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [
              { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'graph-perm', type: 'Role' },
              { resourceAppId: 'api-app-id', id: 'access_as_user', type: 'Scope' },
            ],
            oauth2PermissionScopes: [],
          },
        },
        resourceApplications: {
          'api-app-id': { displayName: 'Sample API App', tags: [], permissions: {} },
        },
      })
    );
    expect(html).toContain('<summary>Dependencies</summary>');
    expect(html).toContain('Sample API App (<code>api-app-id</code>)');
    expect(html).not.toMatch(/Dependencies<\/summary>\s*<ul>[^<]*Microsoft Graph/);
  });

  it('flags a non-Graph dependency whose resource has no service principal in the tenant', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [{ resourceAppId: 'mystery-api', id: 'x', type: 'Scope' }],
            oauth2PermissionScopes: [],
          },
        },
      })
    );
    expect(html).toContain('<code>mystery-api</code> — unresolved (no service principal for it in this tenant)');
  });

  it('shows "None" for Dependencies when every required permission is Microsoft Graph', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [
              { resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'graph-perm', type: 'Role' },
            ],
            oauth2PermissionScopes: [],
          },
        },
      })
    );
    expect(html).toMatch(/<summary>Dependencies<\/summary>\s*<div class="empty">None<\/div>/);
  });

  it('renders Required permissions, Dependencies and Exposed API scopes as collapsed <details> sections', () => {
    const html = buildApplicationPreviewHtml(data());
    for (const title of ['Required permissions', 'Dependencies', 'Exposed API scopes']) {
      expect(html).toContain(`<details class="section"><summary>${title}</summary>`);
    }
    // collapsed by default — no `open` attribute on any section
    expect(html).not.toMatch(/<details class="section" open|<details open class="section"/);
  });

  it('renders an exposed API scope with its value, type, and enabled status', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                value: 'access_as_user',
                type: 'User',
                adminConsentDisplayName: 'Access My App',
                adminConsentDescription: 'Allows access on behalf of the user.',
                userConsentDisplayName: 'Access My App',
                userConsentDescription: 'Allows access on your behalf.',
                isEnabled: true,
              },
            ],
          },
        },
      })
    );
    expect(html).toContain('access_as_user');
    expect(html).toContain('User');
    expect(html).toContain('enabled');
  });

  it('shows a disabled exposed API scope as disabled', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: 'x',
                value: 'legacy_scope',
                type: 'Admin',
                adminConsentDisplayName: '',
                adminConsentDescription: '',
                userConsentDisplayName: '',
                userConsentDescription: '',
                isEnabled: false,
              },
            ],
          },
        },
      })
    );
    expect(html).toContain('legacy_scope');
    expect(html).toContain('disabled');
  });

  it('renders each federated credential with its fields', () => {
    const html = buildApplicationPreviewHtml(
      data({
        federatedCredentials: {
          kind: 'ok',
          value: [
            {
              name: 'dev-deploy',
              issuer: 'https://token.actions.githubusercontent.com',
              subject: 'repo:contoso/sample:environment:dev',
              audiences: ['api://AzureADTokenExchange'],
              description: 'CI/CD',
            },
          ],
        },
      })
    );
    expect(html).toContain('dev-deploy');
    expect(html).toContain('https://token.actions.githubusercontent.com');
    expect(html).toContain('repo:contoso/sample:environment:dev');
    expect(html).toContain('api://AzureADTokenExchange');
    expect(html).toContain('CI/CD');
  });

  it('omits the description line for a federated credential with none', () => {
    const html = buildApplicationPreviewHtml(
      data({
        federatedCredentials: {
          kind: 'ok',
          value: [{ name: 'x', issuer: 'https://issuer.example.com', subject: 'sub', audiences: [], description: '' }],
        },
      })
    );
    expect(html).not.toContain('Description:');
  });

  it('renders service principal fields, including Yes/No for appRoleAssignmentRequired', () => {
    const html = buildApplicationPreviewHtml(
      data({
        servicePrincipal: { kind: 'ok', value: { appId: 'app-1', appRoleAssignmentRequired: true, tags: ['a-tag'] } },
      })
    );
    expect(html).toContain('app-1');
    expect(html).toContain('Yes');
    expect(html).toContain('a-tag');
  });

  it("shows 'No' when appRoleAssignmentRequired is false", () => {
    const html = buildApplicationPreviewHtml(data());
    expect(html).toContain('No');
  });

  it('renders an error block for the application section instead of its fields', () => {
    const html = buildApplicationPreviewHtml(data({ application: { kind: 'error', message: 'boom' } }));
    expect(html).toContain('boom');
    expect(html).toContain('class="error');
  });

  it('renders an error block for the federated credentials section', () => {
    const html = buildApplicationPreviewHtml(data({ federatedCredentials: { kind: 'error', message: 'no permission' } }));
    expect(html).toContain('no permission');
  });

  it('renders an error block for the service principal section', () => {
    const html = buildApplicationPreviewHtml(data({ servicePrincipal: { kind: 'error', message: 'sp lookup failed' } }));
    expect(html).toContain('sp lookup failed');
  });

  it('HTML-escapes field values to prevent injection from tenant-controlled data', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: '<script>alert(1)</script>',
            signInAudience: 'AzureADMyOrg',
            requiredPermissions: [],
            oauth2PermissionScopes: [],
          },
        },
      })
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
