import { describe, it, expect } from 'vitest';
import { buildApplicationPreviewHtml } from './applicationPreviewHtml';
import { ApplicationPreviewData } from './tenantApplicationPreview';

function data(overrides: Partial<ApplicationPreviewData> = {}): ApplicationPreviewData {
  return {
    application: {
      kind: 'ok',
      value: { displayName: 'My App', signInAudience: 'AzureADMyOrg', redirectUris: [], requiredPermissions: [] },
    },
    applicationPublisherDomain: '',
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

  it('shows "None" for empty redirect URIs, required permissions, and tags', () => {
    const html = buildApplicationPreviewHtml(data());
    expect(html.match(/None/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('lists redirect URIs and required permissions when present', () => {
    const html = buildApplicationPreviewHtml(
      data({
        application: {
          kind: 'ok',
          value: {
            displayName: 'My App',
            signInAudience: 'AzureADMyOrg',
            redirectUris: ['https://a.example.com/signin-oidc'],
            requiredPermissions: [{ resourceAppId: '00000003-0000-0000-c000-000000000000', id: 'perm-1', type: 'Scope' }],
          },
        },
      })
    );
    expect(html).toContain('https://a.example.com/signin-oidc');
    expect(html).toContain('00000003-0000-0000-c000-000000000000');
    expect(html).toContain('perm-1');
    expect(html).toContain('Scope');
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
            redirectUris: [],
            requiredPermissions: [],
          },
        },
      })
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
