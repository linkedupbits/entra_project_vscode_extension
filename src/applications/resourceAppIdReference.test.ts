import { describe, it, expect } from 'vitest';
import { parseResourceAppId, buildDependencyReference, MICROSOFT_GRAPH_APP_ID } from './resourceAppIdReference';

describe('parseResourceAppId', () => {
  it('recognises the well-known Microsoft Graph application ID', () => {
    expect(parseResourceAppId(MICROSOFT_GRAPH_APP_ID, [])).toEqual({ kind: 'microsoftGraph' });
  });

  it('recognises a dependency reference matching a known Dependencies key', () => {
    expect(parseResourceAppId('{{ dependency_refs.SampleAPIApp.applicationId }}', ['SampleAPIApp'])).toEqual({
      kind: 'dependency',
      key: 'SampleAPIApp',
    });
  });

  it('tolerates missing or extra whitespace inside the Jinja braces', () => {
    expect(parseResourceAppId('{{dependency_refs.SampleAPIApp.applicationId}}', ['SampleAPIApp'])).toEqual({
      kind: 'dependency',
      key: 'SampleAPIApp',
    });
    expect(parseResourceAppId('{{   dependency_refs.SampleAPIApp.applicationId   }}', ['SampleAPIApp'])).toEqual({
      kind: 'dependency',
      key: 'SampleAPIApp',
    });
  });

  it('treats a dependency reference to a key that no longer exists as unrecognized', () => {
    expect(parseResourceAppId('{{ dependency_refs.RemovedApp.applicationId }}', ['SampleAPIApp'])).toEqual({
      kind: 'unrecognized',
    });
  });

  it('treats an arbitrary raw GUID as unrecognized', () => {
    expect(parseResourceAppId('11111111-1111-1111-1111-111111111111', ['SampleAPIApp'])).toEqual({ kind: 'unrecognized' });
  });

  it('treats an empty string as unrecognized', () => {
    expect(parseResourceAppId('', [])).toEqual({ kind: 'unrecognized' });
  });

  it('treats text that merely resembles the pattern as unrecognized', () => {
    expect(parseResourceAppId('dependency_refs.SampleAPIApp.applicationId', ['SampleAPIApp'])).toEqual({
      kind: 'unrecognized',
    });
  });
});

describe('buildDependencyReference', () => {
  it('builds the exact Jinja reference string the editor writes', () => {
    expect(buildDependencyReference('SampleAPIApp')).toBe('{{ dependency_refs.SampleAPIApp.applicationId }}');
  });
});
