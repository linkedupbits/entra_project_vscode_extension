import { describe, it, expect } from 'vitest';
import { parseEnvironmentVariableIdName, buildEnvironmentVariableIdReference } from './oauth2ScopeIdReference';

describe('parseEnvironmentVariableIdName', () => {
  it('extracts the variable name from a well-formed reference', () => {
    expect(parseEnvironmentVariableIdName('{{ environment.Variables.MyNewPermissionVariableName }}')).toBe(
      'MyNewPermissionVariableName'
    );
  });

  it('tolerates missing or extra whitespace inside the Jinja braces', () => {
    expect(parseEnvironmentVariableIdName('{{environment.Variables.Foo}}')).toBe('Foo');
    expect(parseEnvironmentVariableIdName('{{   environment.Variables.Foo   }}')).toBe('Foo');
  });

  it('returns undefined for a raw GUID', () => {
    expect(parseEnvironmentVariableIdName('11111111-1111-1111-1111-111111111111')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseEnvironmentVariableIdName('')).toBeUndefined();
  });

  it('returns undefined for text that merely resembles the pattern', () => {
    expect(parseEnvironmentVariableIdName('environment.Variables.Foo')).toBeUndefined();
  });
});

describe('buildEnvironmentVariableIdReference', () => {
  it('builds the exact Jinja reference string the editor writes', () => {
    expect(buildEnvironmentVariableIdReference('MyNewPermissionVariableName')).toBe(
      '{{ environment.Variables.MyNewPermissionVariableName }}'
    );
  });
});
