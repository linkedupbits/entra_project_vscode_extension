import { describe, it, expect } from 'vitest';
import { parseTenantApplicationIdentity } from './tenantApplicationIdentity';

describe('parseTenantApplicationIdentity', () => {
  it('parses a well-formed AppName tag', () => {
    expect(parseTenantApplicationIdentity(['AppName:dev_Customer Experience_sample-web-app'])).toEqual({
      environment: 'dev',
      businessUnit: 'Customer Experience',
      appName: 'sample-web-app',
    });
  });

  it('finds the tag regardless of position among other tags', () => {
    expect(
      parseTenantApplicationIdentity(['WindowsAzureActiveDirectoryIntegratedApp', 'AppName:dev_BU_app', 'Environment:{{Environment}}'])
    ).toEqual({ environment: 'dev', businessUnit: 'BU', appName: 'app' });
  });

  it('returns undefined when there is no AppName tag', () => {
    expect(parseTenantApplicationIdentity(['WindowsAzureActiveDirectoryIntegratedApp'])).toBeUndefined();
  });

  it('returns undefined for an empty tags list', () => {
    expect(parseTenantApplicationIdentity([])).toBeUndefined();
  });

  it('returns undefined when the value has too few parts', () => {
    expect(parseTenantApplicationIdentity(['AppName:dev_app'])).toBeUndefined();
  });

  it('returns undefined when the value has too many parts', () => {
    expect(parseTenantApplicationIdentity(['AppName:dev_BU_app_extra'])).toBeUndefined();
  });

  it('returns undefined when any part is blank', () => {
    expect(parseTenantApplicationIdentity(['AppName:dev__app'])).toBeUndefined();
    expect(parseTenantApplicationIdentity(['AppName:_BU_app'])).toBeUndefined();
    expect(parseTenantApplicationIdentity(['AppName:dev_BU_'])).toBeUndefined();
  });

  it('does not match a tag that merely contains "AppName:" without starting with it', () => {
    expect(parseTenantApplicationIdentity(['Prefix:AppName:dev_BU_app'])).toBeUndefined();
  });
});
