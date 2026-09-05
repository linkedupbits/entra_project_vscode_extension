import { describe, it, expect } from 'vitest';
import { resolveApplicationSubmit, ApplicationFormInput } from './applicationFormLogic';

function formInput(overrides: Partial<ApplicationFormInput> = {}): ApplicationFormInput {
  return {
    application_name: 'sample-web-app',
    business_unit: 'Customer Experience',
    variables: [],
    environments: [],
    application: { displayName: '', signInAudience: 'AzureADMyOrg', redirectUris: [], requiredPermissions: [] },
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

  describe('environments', () => {
    const env = (overrides: Partial<ApplicationFormInput['environments'][number]> = {}) => ({
      name: 'Dev',
      publisherDomain: 'contoso-dev.onmicrosoft.com',
      tenancy_type: 'ciam',
      environment_code: 'dev',
      ...overrides,
    });

    it('drops a fully-blank row silently', () => {
      const result = resolveApplicationSubmit(
        formInput({ environments: [{ name: '', publisherDomain: '', tenancy_type: '', environment_code: '' }] })
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
          { name: 'Dev', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'dev' },
          { name: 'Test', publisherDomain: 'contoso-dev.onmicrosoft.com', tenancy_type: 'ciam', environment_code: 'test' },
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
          application: { displayName: '', signInAudience: 'NotARealValue', redirectUris: [], requiredPermissions: [] },
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
          formInput({ application: { displayName: '', signInAudience: value, redirectUris: [], requiredPermissions: [] } })
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
          },
        })
      );
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.files.application.requiredPermissions[0].type).toBe('Role');
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
  });
});
