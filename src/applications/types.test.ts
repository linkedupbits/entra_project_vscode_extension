import { describe, it, expect } from 'vitest';
import {
  emptyAppConfig,
  normalizeAppConfig,
  emptyApplicationFields,
  normalizeApplicationFields,
  groupRequiredPermissions,
  normalizeFederatedCredentials,
  emptyServicePrincipalFields,
  normalizeServicePrincipalFields,
} from './types';

describe('emptyAppConfig', () => {
  it('has blank/empty fields', () => {
    expect(emptyAppConfig()).toEqual({
      application_name: '',
      business_unit: '',
      Variables: {},
      Environments: [],
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
        { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev' },
      ],
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

  it('ignores a non-array Environments value', () => {
    expect(normalizeAppConfig({ Environments: 'not an array' }).Environments).toEqual([]);
  });

  it('defaults missing/non-string fields on an environment entry rather than throwing', () => {
    const result = normalizeAppConfig({ Environments: [{ name: 'Dev', environment_code: 42 }, 'not an object'] });
    expect(result.Environments).toEqual([
      { name: 'Dev', publisherDomain: '', tenancy_type: '', environment_code: '' },
      { name: '', publisherDomain: '', tenancy_type: '', environment_code: '' },
    ]);
  });
});

describe('emptyApplicationFields', () => {
  it('defaults signInAudience to AzureADMyOrg and everything else blank/empty', () => {
    expect(emptyApplicationFields()).toEqual({
      displayName: '',
      signInAudience: 'AzureADMyOrg',
      redirectUris: [],
      requiredPermissions: [],
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

  it('reads displayName, a valid signInAudience, web.redirectUris, and flattens requiredResourceAccess', () => {
    const result = normalizeApplicationFields({
      displayName: 'Sample Web App',
      signInAudience: 'AzureADMultipleOrgs',
      web: { redirectUris: ['https://a.example.com', 'https://b.example.com'] },
      requiredResourceAccess: [
        { resourceAppId: 'graph', resourceAccess: [{ id: 'perm-a', type: 'Scope' }, { id: 'perm-b', type: 'Role' }] },
        { resourceAppId: 'other-api', resourceAccess: [{ id: 'perm-c', type: 'Scope' }] },
      ],
    });
    expect(result).toEqual({
      displayName: 'Sample Web App',
      signInAudience: 'AzureADMultipleOrgs',
      redirectUris: ['https://a.example.com', 'https://b.example.com'],
      requiredPermissions: [
        { resourceAppId: 'graph', id: 'perm-a', type: 'Scope' },
        { resourceAppId: 'graph', id: 'perm-b', type: 'Role' },
        { resourceAppId: 'other-api', id: 'perm-c', type: 'Scope' },
      ],
    });
  });

  it('defaults an invalid/missing signInAudience to AzureADMyOrg', () => {
    expect(normalizeApplicationFields({ signInAudience: 'NotReal' }).signInAudience).toBe('AzureADMyOrg');
    expect(normalizeApplicationFields({}).signInAudience).toBe('AzureADMyOrg');
  });

  it('treats a missing/non-object web as no redirect URIs', () => {
    expect(normalizeApplicationFields({}).redirectUris).toEqual([]);
    expect(normalizeApplicationFields({ web: 'not an object' }).redirectUris).toEqual([]);
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
