import { describe, it, expect } from 'vitest';
import * as YAML from 'yaml';
import {
  AppConfig,
  emptyAppConfig,
  normalizeAppConfig,
  emptyApplicationFields,
  normalizeApplicationFields,
  serializeApplication,
  serializeServicePrincipal,
  groupRequiredPermissions,
  normalizeFederatedCredentials,
  emptyServicePrincipalFields,
  normalizeServicePrincipalFields,
  buildAppConfigNode,
  SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE,
  SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER,
  APPLICATION_REDIRECT_TEMPLATES,
  APPLICATION_REDIRECT_PLACEHOLDERS,
  applyGeneratedRedirectTemplates,
  stripGeneratedRedirectTemplates,
} from './types';

describe('emptyAppConfig', () => {
  it('has blank/empty fields', () => {
    expect(emptyAppConfig()).toEqual({
      application_name: '',
      business_unit: '',
      Variables: {},
      Environments: [],
      Dependencies: {},
    });
  });
});

describe('normalizeAppConfig', () => {
  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['a number', 42],
    ['an array', []],
  ])('returns an empty config for %s', (_label, value) => {
    expect(normalizeAppConfig(value)).toEqual(emptyAppConfig());
  });

  it('reads a fully-populated, well-formed document', () => {
    const parsed = {
      application_name: 'sample-web-app',
      business_unit: 'Customer Experience',
      Variables: { owner_email: 'team@example.com' },
      Environments: [
        {
          name: 'Dev',
          publisherDomain: 'contoso-dev.onmicrosoft.com',
          tenancy_type: 'ciam',
          environment_code: 'dev',
          Variables: { owner_email: 'team@example.com', scopeId: '11111111-1111-1111-1111-111111111111' },
        },
      ],
      Dependencies: { SampleAPIApp: { AppName: 'sample-api' } },
    };
    expect(normalizeAppConfig(parsed)).toEqual(parsed);
  });

  it('defaults missing top-level fields rather than throwing', () => {
    expect(normalizeAppConfig({})).toEqual(emptyAppConfig());
  });

  it('coerces a non-string Variables value to a string rather than dropping it', () => {
    const result = normalizeAppConfig({ Variables: { retries: 3 } });
    expect(result.Variables).toEqual({ retries: '3' });
  });

  it('ignores a non-object Variables value', () => {
    expect(normalizeAppConfig({ Variables: 'not an object' }).Variables).toEqual({});
  });

  it('skips an object/array-valued Variables entry rather than coercing it to "[object Object]"', () => {
    // Regression: a hand-authored `<<: *DefaultVariables` YAML merge key isn't resolved by this
    // codebase's YAML parsing (merge-key support isn't enabled), so it parses as a literal `"<<"`
    // key whose value is the anchor's own object — which must not get stringified into the map.
    const result = normalizeAppConfig({ Variables: { '<<': { owner_email: 'team@example.com' }, safe: 'kept' } });
    expect(result.Variables).toEqual({ safe: 'kept' });
  });

  it('ignores a non-array Environments value', () => {
    expect(normalizeAppConfig({ Environments: 'not an array' }).Environments).toEqual([]);
  });

  it('defaults missing/non-string fields on an environment entry rather than throwing', () => {
    const result = normalizeAppConfig({ Environments: [{ name: 'Dev', environment_code: 42 }, 'not an object'] });
    expect(result.Environments).toEqual([
      { name: 'Dev', publisherDomain: '', tenancy_type: '', environment_code: '', Variables: {} },
      { name: '', publisherDomain: '', tenancy_type: '', environment_code: '', Variables: {} },
    ]);
  });

  it('coerces a non-string environment Variables value to a string rather than dropping it', () => {
    const result = normalizeAppConfig({ Environments: [{ name: 'Dev', Variables: { retries: 3 } }] });
    expect(result.Environments[0].Variables).toEqual({ retries: '3' });
  });

  it('ignores a non-object environment Variables value', () => {
    const result = normalizeAppConfig({ Environments: [{ name: 'Dev', Variables: 'not an object' }] });
    expect(result.Environments[0].Variables).toEqual({});
  });

  it('skips an object-valued (merge-key) environment Variables entry rather than coercing it to "[object Object]"', () => {
    const result = normalizeAppConfig({
      Environments: [{ name: 'Dev', Variables: { '<<': { owner_email: 'team@example.com' }, safe: 'kept' } }],
    });
    expect(result.Environments[0].Variables).toEqual({ safe: 'kept' });
  });

  it('keeps a string-array environment Variables value (a redirect-URI list), dropping non-string entries', () => {
    const result = normalizeAppConfig({
      Environments: [
        {
          name: 'Dev',
          Variables: { web_redirectUris: ['https://a.example.com', 42, 'https://b.example.com'] },
        },
      ],
    });
    expect(result.Environments[0].Variables).toEqual({
      web_redirectUris: ['https://a.example.com', 'https://b.example.com'],
    });
  });

  it('ignores a non-object Dependencies value', () => {
    expect(normalizeAppConfig({ Dependencies: 'not an object' }).Dependencies).toEqual({});
  });

  it('defaults a missing/non-string AppName on a dependency entry rather than throwing', () => {
    const result = normalizeAppConfig({ Dependencies: { SampleAPIApp: {}, Broken: 'not an object' } });
    expect(result.Dependencies).toEqual({ SampleAPIApp: { AppName: '' }, Broken: { AppName: '' } });
  });
});

describe('buildAppConfigNode', () => {
  function stringify(appConfig: AppConfig): string {
    const doc = new YAML.Document();
    doc.contents = buildAppConfigNode(doc, appConfig);
    return doc.toString();
  }

  it('anchors the shared Variables and aliases them from every environment, writing only each environment\'s own overrides alongside the alias', () => {
    const appConfig: AppConfig = {
      ...emptyAppConfig(),
      Variables: { owner_email: 'team@example.com' },
      Environments: [
        { name: 'Dev', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'dev', Variables: { owner_email: 'team@example.com', MyScopeId: '11111111-1111-1111-1111-111111111111' } },
        { name: 'Prod', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'prod', Variables: { owner_email: 'team@example.com' } },
      ],
    };

    const text = stringify(appConfig);

    expect(text).toContain('&DefaultVariables');
    expect(text).toMatch(/<<: \*DefaultVariables/);
    expect(text).toContain('MyScopeId: 11111111-1111-1111-1111-111111111111');
    // The shared default itself isn't duplicated as a literal line inside either environment's
    // own Variables block — only the alias supplies it.
    expect(text.match(/owner_email/g)).toHaveLength(1);
  });

  it('round-trips to the full effective Variables per environment when parsed with merge key support enabled', () => {
    const appConfig: AppConfig = {
      ...emptyAppConfig(),
      Variables: { owner_email: 'team@example.com' },
      Environments: [
        { name: 'Dev', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'dev', Variables: { owner_email: 'team@example.com', MyScopeId: 'abc' } },
      ],
    };

    const parsed = YAML.parse(stringify(appConfig), { merge: true });

    expect(parsed.Environments[0].Variables).toEqual({ owner_email: 'team@example.com', MyScopeId: 'abc' });
  });

  it("writes an environment's array-valued redirect-URI Variables and round-trips them", () => {
    const appConfig: AppConfig = {
      ...emptyAppConfig(),
      Variables: { owner_email: 'team@example.com' },
      Environments: [
        {
          name: 'Dev',
          publisherDomain: '',
          tenancy_type: 'ciam',
          environment_code: 'dev',
          Variables: {
            owner_email: 'team@example.com',
            web_redirectUris: ['https://dev.example.com/signin-oidc'],
            spa_redirectURIs: ['https://dev.example.com'],
          },
        },
      ],
    };

    const parsed = YAML.parse(stringify(appConfig), { merge: true });

    expect(parsed.Environments[0].Variables).toEqual({
      owner_email: 'team@example.com',
      web_redirectUris: ['https://dev.example.com/signin-oidc'],
      spa_redirectURIs: ['https://dev.example.com'],
    });
  });

  it('lets an environment override a shared default with its own different value', () => {
    const appConfig: AppConfig = {
      ...emptyAppConfig(),
      Variables: { owner_email: 'team@example.com' },
      Environments: [
        { name: 'Dev', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'dev', Variables: { owner_email: 'dev-team@example.com' } },
      ],
    };

    const parsed = YAML.parse(stringify(appConfig), { merge: true });

    expect(parsed.Environments[0].Variables).toEqual({ owner_email: 'dev-team@example.com' });
  });

  it('skips the anchor/alias entirely when there are no shared Variables', () => {
    const appConfig: AppConfig = {
      ...emptyAppConfig(),
      Environments: [{ name: 'Dev', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'dev', Variables: { MyScopeId: 'abc' } }],
    };

    const text = stringify(appConfig);

    expect(text).not.toContain('&DefaultVariables');
    expect(text).not.toContain('<<');
    expect(YAML.parse(text, { merge: true }).Environments[0].Variables).toEqual({ MyScopeId: 'abc' });
  });

  it('skips the anchor/alias entirely when there are no environments', () => {
    const appConfig: AppConfig = { ...emptyAppConfig(), Variables: { owner_email: 'team@example.com' } };

    const text = stringify(appConfig);

    expect(text).not.toContain('&DefaultVariables');
  });
});

describe('emptyApplicationFields', () => {
  it('defaults signInAudience to AzureADMyOrg and everything else blank/empty', () => {
    expect(emptyApplicationFields()).toEqual({
      displayName: '',
      signInAudience: 'AzureADMyOrg',
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    });
  });
});

describe('normalizeApplicationFields', () => {
  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['an array', []],
  ])('returns empty fields for %s', (_label, value) => {
    expect(normalizeApplicationFields(value)).toEqual(emptyApplicationFields());
  });

  it('reads displayName, a valid signInAudience, and flattens requiredResourceAccess', () => {
    const result = normalizeApplicationFields({
      displayName: 'Sample Web App',
      signInAudience: 'AzureADMultipleOrgs',
      requiredResourceAccess: [
        { resourceAppId: 'graph', resourceAccess: [{ id: 'perm-a', type: 'Scope' }, { id: 'perm-b', type: 'Role' }] },
        { resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-c', type: 'Scope' }] },
      ],
    });
    expect(result).toEqual({
      displayName: 'Sample Web App',
      signInAudience: 'AzureADMultipleOrgs',
      requiredPermissions: [
        { resourceAppId: 'graph', id: 'perm-a', type: 'Scope' },
        { resourceAppId: 'graph', id: 'perm-b', type: 'Role' },
        { resourceAppId: 'other-api', id: 'perm-c', type: 'Scope' },
      ],
      oauth2PermissionScopes: [],
    });
  });

  it('defaults an invalid/missing signInAudience to AzureADMyOrg', () => {
    expect(normalizeApplicationFields({ signInAudience: 'NotReal' }).signInAudience).toBe('AzureADMyOrg');
    expect(normalizeApplicationFields({}).signInAudience).toBe('AzureADMyOrg');
  });

  it('ignores a non-array requiredResourceAccess', () => {
    expect(normalizeApplicationFields({ requiredResourceAccess: 'not an array' }).requiredPermissions).toEqual([]);
  });

  it('skips a non-object entry in requiredResourceAccess', () => {
    const result = normalizeApplicationFields({ requiredResourceAccess: ['not an object', { resourceAppId: 'graph' }] });
    expect(result.requiredPermissions).toEqual([]);
  });

  it('skips a non-object item within one entry\'s resourceAccess, and defaults a missing/invalid type to Scope', () => {
    const result = normalizeApplicationFields({
      requiredResourceAccess: [
        { resourceAppId: 'graph', resourceAccess: ['not an object', { id: 'perm-a' }, { id: 'perm-b', type: 'NotAType' }] },
      ],
    });
    expect(result.requiredPermissions).toEqual([
      { resourceAppId: 'graph', id: 'perm-a', type: 'Scope' },
      { resourceAppId: 'graph', id: 'perm-b', type: 'Scope' },
    ]);
  });

  it('treats a missing resourceAccess on an entry as no permissions for it', () => {
    expect(normalizeApplicationFields({ requiredResourceAccess: [{ resourceAppId: 'graph' }] }).requiredPermissions).toEqual(
      []
    );
  });
});

describe('normalizeApplicationFields > oauth2PermissionScopes', () => {
  const scope = {
    id: '11111111-1111-1111-1111-111111111111',
    value: 'access_as_user',
    type: 'User',
    adminConsentDisplayName: 'Access sample-web-app',
    adminConsentDescription: 'Allows the app to access sample-web-app on behalf of the signed-in user.',
    userConsentDisplayName: 'Access sample-web-app',
    userConsentDescription: 'Allows the app to access sample-web-app on your behalf.',
    isEnabled: true,
  };

  it('reads a well-formed scope from api.oauth2PermissionScopes', () => {
    const result = normalizeApplicationFields({ api: { oauth2PermissionScopes: [scope] } });
    expect(result.oauth2PermissionScopes).toEqual([scope]);
  });

  it('ignores a non-object api value', () => {
    expect(normalizeApplicationFields({ api: 'not an object' }).oauth2PermissionScopes).toEqual([]);
  });

  it('ignores a non-array oauth2PermissionScopes value', () => {
    expect(normalizeApplicationFields({ api: { oauth2PermissionScopes: 'not an array' } }).oauth2PermissionScopes).toEqual(
      []
    );
  });

  it('defaults isEnabled to true when omitted, matching Graph\'s own default at creation', () => {
    const result = normalizeApplicationFields({ api: { oauth2PermissionScopes: [{ value: 'x' }] } });
    expect(result.oauth2PermissionScopes[0].isEnabled).toBe(true);
  });

  it('preserves an explicit isEnabled: false', () => {
    const result = normalizeApplicationFields({ api: { oauth2PermissionScopes: [{ value: 'x', isEnabled: false }] } });
    expect(result.oauth2PermissionScopes[0].isEnabled).toBe(false);
  });

  it('defaults an invalid/missing type to User', () => {
    expect(normalizeApplicationFields({ api: { oauth2PermissionScopes: [{ value: 'x' }] } }).oauth2PermissionScopes[0].type).toBe(
      'User'
    );
    expect(
      normalizeApplicationFields({ api: { oauth2PermissionScopes: [{ value: 'x', type: 'NotAType' }] } })
        .oauth2PermissionScopes[0].type
    ).toBe('User');
  });

  it('keeps an Admin type as given', () => {
    expect(
      normalizeApplicationFields({ api: { oauth2PermissionScopes: [{ value: 'x', type: 'Admin' }] } })
        .oauth2PermissionScopes[0].type
    ).toBe('Admin');
  });
});

describe('serializeApplication > redirect blocks', () => {
  it('always emits web/publicClient/spa with the redirect placeholders (swapped for the loops after stringify)', () => {
    const result = serializeApplication(emptyApplicationFields());
    expect(result.web).toEqual({
      redirectUris: APPLICATION_REDIRECT_PLACEHOLDERS.webRedirectUris,
      redirectUriSettings: APPLICATION_REDIRECT_PLACEHOLDERS.webRedirectUriSettings,
    });
    expect(result.publicClient).toEqual({ redirectUris: APPLICATION_REDIRECT_PLACEHOLDERS.publicClientRedirectUris });
    expect(result.spa).toEqual({ redirectUris: APPLICATION_REDIRECT_PLACEHOLDERS.spaRedirectUris });
  });

  it('applyGeneratedRedirectTemplates swaps every placeholder for its loop, indentation preserved', () => {
    const applied = applyGeneratedRedirectTemplates(YAML.stringify(serializeApplication(emptyApplicationFields())));
    expect(applied).toContain(`  redirectUris: ${APPLICATION_REDIRECT_TEMPLATES.webRedirectUris}`);
    expect(applied).toContain(`  redirectUriSettings: ${APPLICATION_REDIRECT_TEMPLATES.webRedirectUriSettings}`);
    expect(applied).toContain(`  redirectUris: ${APPLICATION_REDIRECT_TEMPLATES.publicClientRedirectUris}`);
    expect(applied).toContain(`  redirectUris: ${APPLICATION_REDIRECT_TEMPLATES.spaRedirectUris}`);
    expect(applied).not.toContain('__ENTRA_');
    // once applied, the file no longer parses as YAML (the loops aren't valid values)
    expect(() => YAML.parse(applied)).toThrow();
  });

  it('the two rendered array shapes both parse as YAML (strings, and {uri,index} objects)', () => {
    expect(YAML.parse('x: ["https://a", "https://b"]').x).toEqual(['https://a', 'https://b']);
    expect(YAML.parse('x: [{"uri": "https://a", "index": null}, {"uri": "https://b", "index": null}]').x).toEqual([
      { uri: 'https://a', index: null },
      { uri: 'https://b', index: null },
    ]);
    expect(YAML.parse('x: []').x).toEqual([]);
  });

  it('the web.redirectUriSettings template emits {"uri": ..., "index": null} objects, always null index', () => {
    expect(APPLICATION_REDIRECT_TEMPLATES.webRedirectUriSettings).toBe(
      '[{% for item in (environment.Variables.web_redirectUris | default([])) %}' +
        '{"uri": "{{ item }}", "index": null}{% if not loop.last %}, {% endif %}{% endfor %}]'
    );
  });

  it('each string-array redirect template pulls from its own environment variable list', () => {
    expect(APPLICATION_REDIRECT_TEMPLATES.webRedirectUris).toContain('environment.Variables.web_redirectUris');
    expect(APPLICATION_REDIRECT_TEMPLATES.publicClientRedirectUris).toContain('environment.Variables.publicClient_redirectURIs');
    expect(APPLICATION_REDIRECT_TEMPLATES.spaRedirectUris).toContain('environment.Variables.spa_redirectURIs');
  });

  it('stripGeneratedRedirectTemplates drops the loop lines, leaving web/publicClient/spa as null keys', () => {
    const applied = applyGeneratedRedirectTemplates(YAML.stringify(serializeApplication(emptyApplicationFields())));
    const parsed = YAML.parse(stripGeneratedRedirectTemplates(applied));
    expect(parsed).toEqual({ displayName: '', signInAudience: 'AzureADMyOrg', web: null, publicClient: null, spa: null });
  });
});

describe('serializeApplication > oauth2PermissionScopes', () => {
  it('omits api entirely when there are no scopes', () => {
    const result = serializeApplication(emptyApplicationFields());
    expect(result).not.toHaveProperty('api');
  });

  it('writes api.oauth2PermissionScopes with every field in a fixed order when scopes are present', () => {
    const result = serializeApplication({
      ...emptyApplicationFields(),
      oauth2PermissionScopes: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          value: 'access_as_user',
          type: 'User',
          adminConsentDisplayName: 'Access sample-web-app',
          adminConsentDescription: 'Allows access on behalf of the user.',
          userConsentDisplayName: 'Access sample-web-app',
          userConsentDescription: 'Allows access on your behalf.',
          isEnabled: true,
        },
      ],
    });
    expect(result.api).toEqual({
      oauth2PermissionScopes: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          adminConsentDescription: 'Allows access on behalf of the user.',
          adminConsentDisplayName: 'Access sample-web-app',
          isEnabled: true,
          type: 'User',
          userConsentDescription: 'Allows access on your behalf.',
          userConsentDisplayName: 'Access sample-web-app',
          value: 'access_as_user',
        },
      ],
    });
  });
});

describe('groupRequiredPermissions', () => {
  it('returns an empty array for no rows', () => {
    expect(groupRequiredPermissions([])).toEqual([]);
  });

  it('groups rows sharing a resourceAppId together, preserving first-seen order', () => {
    const result = groupRequiredPermissions([
      { resourceAppId: 'graph', id: 'perm-a', type: 'Scope' },
      { resourceAppId: 'other-api', id: 'perm-c', type: 'Scope' },
      { resourceAppId: 'graph', id: 'perm-b', type: 'Role' },
    ]);
    expect(result).toEqual([
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
});

describe('normalizeFederatedCredentials', () => {
  it('returns an empty array for non-array input', () => {
    expect(normalizeFederatedCredentials('not an array')).toEqual([]);
    expect(normalizeFederatedCredentials(null)).toEqual([]);
  });

  it('normalizes a well-formed list', () => {
    const parsed = [
      {
        name: 'dev-deploy',
        issuer: 'https://token.actions.githubusercontent.com',
        subject: 'repo:contoso/sample:environment:dev',
        audiences: ['api://AzureADTokenExchange'],
        description: 'OIDC federation',
      },
    ];
    expect(normalizeFederatedCredentials(parsed)).toEqual(parsed);
  });

  it('defaults a non-object entry to blank fields rather than throwing', () => {
    expect(normalizeFederatedCredentials(['not an object'])).toEqual([
      { name: '', issuer: '', subject: '', audiences: [], description: '' },
    ]);
  });

  it('ignores a non-array audiences value on an entry', () => {
    expect(normalizeFederatedCredentials([{ audiences: 'not an array' }])[0].audiences).toEqual([]);
  });
});

describe('emptyServicePrincipalFields', () => {
  it('defaults to blank/false/empty', () => {
    expect(emptyServicePrincipalFields()).toEqual({ appId: '', appRoleAssignmentRequired: false, tags: [] });
  });
});

describe('serializeServicePrincipal', () => {
  it('emits replyUrls as the placeholder (the real loop template is injected after YAML.stringify)', () => {
    const result = serializeServicePrincipal({ appId: 'x', appRoleAssignmentRequired: true, tags: ['t'] });
    expect(result).toEqual({
      appId: 'x',
      appRoleAssignmentRequired: true,
      replyUrls: SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER,
      tags: ['t'],
    });
  });
});

describe('SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE', () => {
  it('is a for-loop over the three redirect-URI variable lists concatenated, emitting literal array syntax', () => {
    expect(SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE).toBe(
      '[{% for item in (environment.Variables.web_redirectUris | default([])) + ' +
        '(environment.Variables.publicClient_redirectURIs | default([])) + ' +
        '(environment.Variables.spa_redirectURIs | default([])) %}' +
        '"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]'
    );
  });
});

describe('applyGeneratedRedirectTemplates / stripGeneratedRedirectTemplates', () => {
  it('swaps the placeholder line for the raw loop, keeping the line indentation', () => {
    const top = YAML.stringify(serializeServicePrincipal(emptyServicePrincipalFields()));
    expect(applyGeneratedRedirectTemplates(top)).toContain(`replyUrls: ${SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE}`);
    expect(applyGeneratedRedirectTemplates(top)).not.toContain(SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER);

    const indented = `ServicePrincipal:\n  appId: ""\n  replyUrls: ${SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER}\n`;
    expect(applyGeneratedRedirectTemplates(indented)).toContain(`  replyUrls: ${SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE}`);
  });

  it('removes the replyUrls line (raw loop or placeholder) so the rest is valid YAML', () => {
    const withLoop = applyGeneratedRedirectTemplates(YAML.stringify(serializeServicePrincipal({ appId: 'a', appRoleAssignmentRequired: true, tags: ['t'] })));
    expect(() => YAML.parse(withLoop)).toThrow();

    const stripped = stripGeneratedRedirectTemplates(withLoop);
    expect(stripped).not.toContain('replyUrls');
    expect(YAML.parse(stripped)).toEqual({ appId: 'a', appRoleAssignmentRequired: true, tags: ['t'] });
  });
});

describe('normalizeServicePrincipalFields', () => {
  it.each([
    ['null', null],
    ['a string', 'not an object'],
  ])('returns empty fields for %s', (_label, value) => {
    expect(normalizeServicePrincipalFields(value)).toEqual(emptyServicePrincipalFields());
  });

  it('reads a well-formed document', () => {
    const parsed = { appId: '{{ application.appId }}', appRoleAssignmentRequired: true, tags: ['a-tag'] };
    expect(normalizeServicePrincipalFields(parsed)).toEqual(parsed);
  });

  it('treats any non-true appRoleAssignmentRequired as false', () => {
    expect(normalizeServicePrincipalFields({ appRoleAssignmentRequired: 'yes' }).appRoleAssignmentRequired).toBe(false);
    expect(normalizeServicePrincipalFields({}).appRoleAssignmentRequired).toBe(false);
  });

  it('ignores a non-array tags value', () => {
    expect(normalizeServicePrincipalFields({ tags: 'not an array' }).tags).toEqual([]);
  });
});
