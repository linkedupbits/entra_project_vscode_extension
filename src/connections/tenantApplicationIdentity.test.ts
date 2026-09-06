import { describe, it, expect } from 'vitest';
import {
  parseTenantApplicationIdentity,
  parseUniqueName,
  hasEnvironmentTag,
  environmentTagValue,
} from './tenantApplicationIdentity';

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

describe('parseUniqueName', () => {
  it('splits a well-formed 3-part unique name', () => {
    expect(parseUniqueName('dev_Customer Experience_sample-web-app')).toEqual({
      environment: 'dev',
      businessUnit: 'Customer Experience',
      appName: 'sample-web-app',
    });
  });

  it('returns undefined when there are not exactly three parts', () => {
    expect(parseUniqueName('Sample API App')).toBeUndefined();
    expect(parseUniqueName('dev_BU')).toBeUndefined();
    expect(parseUniqueName('dev_BU_app_extra')).toBeUndefined();
  });

  it('returns undefined when any part is blank', () => {
    expect(parseUniqueName('dev__app')).toBeUndefined();
    expect(parseUniqueName('_BU_app')).toBeUndefined();
  });
});

describe('hasEnvironmentTag', () => {
  it('returns true when a tag starts with "Environment:"', () => {
    expect(hasEnvironmentTag(['AppName:dev_BU_app', 'Environment:dev'])).toBe(true);
  });

  it('returns true even when the tag value is still the unresolved literal placeholder', () => {
    expect(hasEnvironmentTag(['Environment:{{Environment}}'])).toBe(true);
  });

  it('returns false when there is no Environment: tag', () => {
    expect(hasEnvironmentTag(['AppName:dev_BU_app', 'a-custom-tag'])).toBe(false);
  });

  it('returns false for an empty tags list', () => {
    expect(hasEnvironmentTag([])).toBe(false);
  });

  it('does not match a tag that merely contains "Environment:" without starting with it', () => {
    expect(hasEnvironmentTag(['Prefix:Environment:dev'])).toBe(false);
  });
});

describe('environmentTagValue', () => {
  it('returns the value after "Environment:"', () => {
    expect(environmentTagValue(['AppName:dev_BU_app', 'Environment:dev'])).toBe('dev');
  });

  it('trims surrounding whitespace from the value', () => {
    expect(environmentTagValue(['Environment:  production  '])).toBe('production');
  });

  it('returns the unresolved literal placeholder as-is', () => {
    expect(environmentTagValue(['Environment:{{Environment}}'])).toBe('{{Environment}}');
  });

  it('returns undefined when the value is blank or whitespace only', () => {
    expect(environmentTagValue(['Environment:'])).toBeUndefined();
    expect(environmentTagValue(['Environment:   '])).toBeUndefined();
  });

  it('returns undefined when there is no Environment: tag', () => {
    expect(environmentTagValue(['AppName:dev_BU_app'])).toBeUndefined();
    expect(environmentTagValue([])).toBeUndefined();
  });

  it('uses the first Environment: tag when several are present', () => {
    expect(environmentTagValue(['Environment:dev', 'Environment:prod'])).toBe('dev');
  });
});
