import { describe, it, expect } from 'vitest';
import { resolveApplicationSubmit, ApplicationFormInput } from './applicationFormLogic';

function env(overrides: Partial<ApplicationFormInput['environments'][number]> = {}) {
  return {
    name: 'Dev',
    publisherDomain: 'contoso-dev.onmicrosoft.com',
    tenancy_type: 'ciam',
    environment_code: 'dev',
    variables: {},
    ...overrides,
  };
}

function formInput(overrides: Partial<ApplicationFormInput> = {}): ApplicationFormInput {
  return {
    application_name: 'sample-web-app',
    business_unit: 'Customer Experience',
    variables: [],
    environments: [],
    dependencies: [],
    application: {
      displayName: '',
      signInAudience: 'AzureADMyOrg',
      redirectUris: [],
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    },
    federatedCredentials: [],
    servicePrincipal: { appId: '', appRoleAssignmentRequired: false, tags: [] },
    ...overrides,
  };
}

describe('resolveApplicationSubmit', () => {
  it('reports missingApplicationName when blank', () => {
    expect(resolveApplicationSubmit(formInput({ application_name: '   ' }))).toEqual({
      kind: 'missingApplicationName',
    });
  });

  it('trims application_name and business_unit', () => {
    const result = resolveApplicationSubmit(
      formInput({ application_name: '  sample-web-app  ', business_unit: '  Customer Experience  ' })
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.files.appConfig.application_name).toBe('sample-web-app');
      expect(result.files.appConfig.business_unit).toBe('Customer Experience');
    }
  });

  describe('variables', () => {
    it('drops a fully-blank row silently', () => {
      const result = resolveApplicationSubmit(formInput({ variables: [{ key: '  ', value: '  ' }] }));
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Variables).toEqual({});
      }
    });

    it('reports missingVariableKey when a value is given without a key', () => {
      const result = resolveApplicationSubmit(formInput({ variables: [{ key: '', value: 'AValue' }] }));
      expect(result).toEqual({ kind: 'missingVariableKey' });
    });

    it('reports duplicateVariableKey', () => {
      const result = resolveApplicationSubmit(
        formInput({
          variables: [
            { key: 'owner_email', value: 'a@example.com' },
            { key: 'owner_email', value: 'b@example.com' },
          ],
        })
      );
      expect(result).toEqual({ kind: 'duplicateVariableKey', key: 'owner_email' });
    });

    it('collects trimmed key/value pairs', () => {
      const result = resolveApplicationSubmit(
        formInput({ variables: [{ key: '  owner_email  ', value: '  team@example.com  ' }] })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Variables).toEqual({ owner_email: 'team@example.com' });
      }
    });
  });

  describe('dependencies', () => {
    it('drops a fully-blank row silently', () => {
      const result = resolveApplicationSubmit(formInput({ dependencies: [{ key: '  ', appName: '  ' }] }));
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Dependencies).toEqual({});
      }
    });

    it('reports missingDependencyKey when an application is selected without a key', () => {
      const result = resolveApplicationSubmit(formInput({ dependencies: [{ key: '', appName: 'sample-api' }] }));
      expect(result).toEqual({ kind: 'missingDependencyKey' });
    });

    it('reports missingDependencyAppName when a key is given without an application', () => {
      const result = resolveApplicationSubmit(formInput({ dependencies: [{ key: 'SampleAPIApp', appName: '' }] }));
      expect(result).toEqual({ kind: 'missingDependencyAppName', key: 'SampleAPIApp' });
    });

    it('reports duplicateDependencyKey', () => {
      const result = resolveApplicationSubmit(
        formInput({
          dependencies: [
            { key: 'SampleAPIApp', appName: 'sample-api' },
            { key: 'SampleAPIApp', appName: 'sample-api-v2' },
          ],
        })
      );
      expect(result).toEqual({ kind: 'duplicateDependencyKey', key: 'SampleAPIApp' });
    });

    it('collects trimmed key/appName pairs', () => {
      const result = resolveApplicationSubmit(
        formInput({ dependencies: [{ key: '  SampleAPIApp  ', appName: '  sample-api  ' }] })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Dependencies).toEqual({ SampleAPIApp: { AppName: 'sample-api' } });
      }
    });
  });

  describe('environments', () => {
    it('drops a fully-blank row silently', () => {
      const result = resolveApplicationSubmit(
        formInput({
          environments: [{ name: '', publisherDomain: '', tenancy_type: '', environment_code: '', variables: {} }],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments).toEqual([]);
      }
    });

    it('reports missingEnvironmentName with the row index when other fields are filled in', () => {
      const result = resolveApplicationSubmit(formInput({ environments: [env({ name: '' })] }));
      expect(result).toEqual({ kind: 'missingEnvironmentName', index: 0 });
    });

    it('reports duplicateEnvironmentName, case-insensitively', () => {
      const result = resolveApplicationSubmit(
        formInput({ environments: [env({ name: 'Dev' }), env({ name: 'dev', environment_code: 'dev2' })] })
      );
      expect(result).toEqual({ kind: 'duplicateEnvironmentName', name: 'dev' });
    });

    it('collects trimmed environment entries in order', () => {
      const result = resolveApplicationSubmit(
        formInput({ environments: [env({ name: ' Dev ' }), env({ name: 'Test', environment_code: 'test' })] })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments).toEqual([
          {
            name: 'Dev',
            publisherDomain: 'contoso-dev.onmicrosoft.com',
            tenancy_type: 'ciam',
            environment_code: 'dev',
            Variables: {},
          },
          {
            name: 'Test',
            publisherDomain: 'contoso-dev.onmicrosoft.com',
            tenancy_type: 'ciam',
            environment_code: 'test',
            Variables: {},
          },
        ]);
      }
    });
  });

  describe('application', () => {
    it('trims displayName and drops blank redirect URI rows', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '  Sample Web App  ',
            signInAudience: 'AzureADMyOrg',
            redirectUris: ['  https://a.example.com/signin-oidc  ', '   ', ''],
            requiredPermissions: [],
            oauth2PermissionScopes: [],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.displayName).toBe('Sample Web App');
        expect(result.files.application.redirectUris).toEqual(['https://a.example.com/signin-oidc']);
      }
    });

    it('coerces an unrecognised signInAudience to the default', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'NotARealValue',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.signInAudience).toBe('AzureADMyOrg');
      }
    });

    it('accepts every real Graph signInAudience value unchanged', () => {
      for (const value of [
        'AzureADMyOrg',
        'AzureADMultipleOrgs',
        'AzureADandPersonalMicrosoftAccount',
        'PersonalMicrosoftAccount',
      ] as const) {
        const result = resolveApplicationSubmit(
          formInput({
            application: {
              displayName: '',
              signInAudience: value,
              redirectUris: [],
              requiredPermissions: [],
              oauth2PermissionScopes: [],
            },
          })
        );
        expect(result.kind).toBe('ok');
        if (result.kind === 'ok') {
          expect(result.files.application.signInAudience).toBe(value);
        }
      }
    });

    it('drops a required-permission row with neither a resource app ID nor a permission ID', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [{ resourceAppId: '  ', id: '  ', type: 'Scope' }],
            oauth2PermissionScopes: [],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.requiredPermissions).toEqual([]);
      }
    });

    it('trims permission rows and defaults an invalid type to Scope', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [{ resourceAppId: '  00000003-...  ', id: '  abc  ', type: 'NotAType' }],
            oauth2PermissionScopes: [],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.requiredPermissions).toEqual([
          { resourceAppId: '00000003-...', id: 'abc', type: 'Scope' },
        ]);
      }
    });

    it('keeps a Role type as given', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [{ resourceAppId: 'x', id: 'y', type: 'Role' }],
            oauth2PermissionScopes: [],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.requiredPermissions[0].type).toBe('Role');
      }
    });
  });

  describe('oauth2PermissionScopes', () => {
    it('drops a row that is entirely blank', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: 'auto-generated-id',
                idVariableName: '',
                value: ' ',
                type: 'User',
                adminConsentDisplayName: ' ',
                adminConsentDescription: ' ',
                userConsentDisplayName: ' ',
                userConsentDescription: ' ',
                isEnabled: true,
              },
            ],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.oauth2PermissionScopes).toEqual([]);
      }
    });

    it('trims fields, coerces an invalid type to User, and passes isEnabled through unchanged', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: '  11111111-1111-1111-1111-111111111111  ',
                idVariableName: '',
                value: '  access_as_user  ',
                type: 'NotAType',
                adminConsentDisplayName: '  Access sample-web-app  ',
                adminConsentDescription: '  Allows access on behalf of the user.  ',
                userConsentDisplayName: '  Access sample-web-app  ',
                userConsentDescription: '  Allows access on your behalf.  ',
                isEnabled: false,
              },
            ],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.oauth2PermissionScopes).toEqual([
          {
            id: '11111111-1111-1111-1111-111111111111',
            value: 'access_as_user',
            type: 'User',
            adminConsentDisplayName: 'Access sample-web-app',
            adminConsentDescription: 'Allows access on behalf of the user.',
            userConsentDisplayName: 'Access sample-web-app',
            userConsentDescription: 'Allows access on your behalf.',
            isEnabled: false,
          },
        ]);
      }
    });

    it('keeps an Admin type as given', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: 'x',
                idVariableName: '',
                value: 'admin_scope',
                type: 'Admin',
                adminConsentDisplayName: '',
                adminConsentDescription: '',
                userConsentDisplayName: '',
                userConsentDescription: '',
                isEnabled: true,
              },
            ],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.oauth2PermissionScopes[0].type).toBe('Admin');
      }
    });

    it('writes the id as an environment.Variables Jinja reference when an ID variable name is given', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                idVariableName: '  MyNewPermissionVariableName  ',
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
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.oauth2PermissionScopes[0].id).toBe(
          '{{ environment.Variables.MyNewPermissionVariableName }}'
        );
      }
    });

    it('falls back to the row id unchanged when the ID variable name is blank', () => {
      const result = resolveApplicationSubmit(
        formInput({
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [
              {
                id: '  11111111-1111-1111-1111-111111111111  ',
                idVariableName: '   ',
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
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.oauth2PermissionScopes[0].id).toBe('11111111-1111-1111-1111-111111111111');
      }
    });

    function oauth2Scope(idVariableName: string) {
      return {
        id: 'fallback-id',
        idVariableName,
        value: 'access_as_user',
        type: 'User' as const,
        adminConsentDisplayName: '',
        adminConsentDescription: '',
        userConsentDisplayName: '',
        userConsentDescription: '',
        isEnabled: true,
      };
    }

    it('generates a GUID for the ID variable name in every environment that is missing it', () => {
      const result = resolveApplicationSubmit(
        formInput({
          environments: [env({ name: 'Dev' }), env({ name: 'Test', environment_code: 'test' })],
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [oauth2Scope('MyNewPermissionVariableName')],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const environment of result.files.appConfig.Environments) {
          expect(environment.Variables.MyNewPermissionVariableName).toMatch(guidPattern);
        }
      }
    });

    it('does not overwrite an environment that already has a value for the ID variable name', () => {
      const result = resolveApplicationSubmit(
        formInput({
          environments: [env({ name: 'Dev', variables: { MyNewPermissionVariableName: 'existing-value' } })],
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [oauth2Scope('MyNewPermissionVariableName')],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments[0].Variables.MyNewPermissionVariableName).toBe('existing-value');
      }
    });

    it('leaves every environment untouched when no scope has an ID variable name', () => {
      const result = resolveApplicationSubmit(
        formInput({
          environments: [env({ name: 'Dev' })],
          application: {
            displayName: '',
            signInAudience: 'AzureADMyOrg',
            redirectUris: [],
            requiredPermissions: [],
            oauth2PermissionScopes: [oauth2Scope('')],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments[0].Variables).toEqual({});
      }
    });
  });

  describe('environments > Variables merging', () => {
    it('merges the top-level shared Variables into every environment, mirroring the Variables: &DefaultVariables convention', () => {
      const result = resolveApplicationSubmit(
        formInput({
          variables: [{ key: 'owner_email', value: 'team@example.com' }],
          environments: [
            { name: 'Dev', publisherDomain: '', tenancy_type: 'ciam', environment_code: 'dev', variables: {} },
          ],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments[0].Variables).toEqual({ owner_email: 'team@example.com' });
      }
    });

    it("lets an environment's own Variables override a shared default of the same key", () => {
      const result = resolveApplicationSubmit(
        formInput({
          variables: [{ key: 'owner_email', value: 'team@example.com' }],
          environments: [
            {
              name: 'Dev',
              publisherDomain: '',
              tenancy_type: 'ciam',
              environment_code: 'dev',
              variables: { owner_email: 'dev-team@example.com' },
            },
          ],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.appConfig.Environments[0].Variables).toEqual({ owner_email: 'dev-team@example.com' });
      }
    });
  });

  describe('federatedCredentials', () => {
    it('drops a row that is entirely blank', () => {
      const result = resolveApplicationSubmit(
        formInput({
          federatedCredentials: [{ name: ' ', issuer: ' ', subject: ' ', audiences: ' , ', description: ' ' }],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.federatedCredentials).toEqual([]);
      }
    });

    it('splits comma-separated audiences, trimming each and dropping empty segments', () => {
      const result = resolveApplicationSubmit(
        formInput({
          federatedCredentials: [
            {
              name: 'dev-deploy',
              issuer: 'https://token.actions.githubusercontent.com',
              subject: 'repo:contoso/sample:environment:dev',
              audiences: ' api://AzureADTokenExchange ,  , second-audience ',
              description: '',
            },
          ],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.federatedCredentials).toEqual([
          {
            name: 'dev-deploy',
            issuer: 'https://token.actions.githubusercontent.com',
            subject: 'repo:contoso/sample:environment:dev',
            audiences: ['api://AzureADTokenExchange', 'second-audience'],
            description: '',
          },
        ]);
      }
    });

    it('keeps a row with only a single audience and nothing else', () => {
      const result = resolveApplicationSubmit(
        formInput({
          federatedCredentials: [{ name: '', issuer: '', subject: '', audiences: 'api://AzureADTokenExchange', description: '' }],
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.federatedCredentials).toHaveLength(1);
      }
    });
  });

  describe('servicePrincipal', () => {
    it('trims appId, passes the checkbox through, and drops blank tag rows', () => {
      const result = resolveApplicationSubmit(
        formInput({
          servicePrincipal: {
            appId: '  {{ application.appId }}  ',
            appRoleAssignmentRequired: true,
            tags: ['  WindowsAzureActiveDirectoryIntegratedApp  ', '  ', ''],
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.servicePrincipal).toEqual({
          appId: '{{ application.appId }}',
          appRoleAssignmentRequired: true,
          tags: ['WindowsAzureActiveDirectoryIntegratedApp'],
        });
      }
    });

    it.each([['AppName:'], ['Environment:'], ['BusinessUnit:']])(
      'rejects a custom tag starting with the reserved prefix %s',
      (prefix) => {
        const result = resolveApplicationSubmit(
          formInput({ servicePrincipal: { appId: '', appRoleAssignmentRequired: false, tags: [prefix + 'whatever'] } })
        );
        expect(result).toEqual({ kind: 'reservedTagPrefix', tag: prefix + 'whatever', prefix });
      }
    );

    it('allows a tag that merely contains a reserved prefix without starting with it', () => {
      const result = resolveApplicationSubmit(
        formInput({
          servicePrincipal: { appId: '', appRoleAssignmentRequired: false, tags: ['Prefix:AppName:whatever'] },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.servicePrincipal.tags).toEqual(['Prefix:AppName:whatever']);
      }
    });

    it('trims a tag before checking it against reserved prefixes', () => {
      const result = resolveApplicationSubmit(
        formInput({ servicePrincipal: { appId: '', appRoleAssignmentRequired: false, tags: ['  AppName:whatever  '] } })
      );
      expect(result).toEqual({ kind: 'reservedTagPrefix', tag: 'AppName:whatever', prefix: 'AppName:' });
    });
  });
});
