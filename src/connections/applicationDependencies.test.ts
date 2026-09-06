import { describe, it, expect } from 'vitest';
import { deriveApplicationDependencies } from './applicationDependencies';
import { RequiredPermission } from '../applications/types';
import { GraphResourceApplication } from '../graph/graphClient';

const GRAPH = '00000003-0000-0000-c000-000000000000';

function perm(resourceAppId: string, id = 'p', type: RequiredPermission['type'] = 'Scope'): RequiredPermission {
  return { resourceAppId, id, type };
}

function resource(displayName: string): GraphResourceApplication {
  return { displayName, permissions: {} };
}

describe('deriveApplicationDependencies', () => {
  it('ignores Microsoft Graph permissions entirely', () => {
    const result = deriveApplicationDependencies([perm(GRAPH, 'a'), perm(GRAPH, 'b')], {}, {});
    expect(result.derived).toEqual([]);
    expect(result.dependencies).toEqual({});
    expect(result.resourceAppIdRewrites).toEqual({});
  });

  it('ignores blank resourceAppIds', () => {
    const result = deriveApplicationDependencies([perm('')], {}, {});
    expect(result.derived).toEqual([]);
  });

  it('derives one dependency per distinct non-Graph resource, keyed by its squashed display name', () => {
    const resources = { 'api-1': resource('Sample API App') };
    const result = deriveApplicationDependencies([perm('api-1', 'x'), perm('api-1', 'y'), perm(GRAPH)], resources, {});

    expect(result.derived).toEqual([
      { key: 'SampleAPIApp', appName: 'Sample API App', resourceAppId: 'api-1', resolved: true },
    ]);
    expect(result.dependencies).toEqual({ SampleAPIApp: { AppName: 'Sample API App' } });
    expect(result.resourceAppIdRewrites).toEqual({
      'api-1': '{{ dependency_refs.SampleAPIApp.applicationId }}',
    });
  });

  it('keys an unresolved resource by its appId', () => {
    const result = deriveApplicationDependencies([perm('mystery-api')], {}, {});
    expect(result.derived).toEqual([
      { key: 'mystery-api', appName: 'mystery-api', resourceAppId: 'mystery-api', resolved: false },
    ]);
    expect(result.dependencies).toEqual({ 'mystery-api': { AppName: 'mystery-api' } });
    expect(result.resourceAppIdRewrites['mystery-api']).toBe('{{ dependency_refs.mystery-api.applicationId }}');
  });

  it('merges with existing dependencies without overwriting them', () => {
    const existing = { OtherThing: { AppName: 'other-thing' } };
    const result = deriveApplicationDependencies([perm('api-1')], { 'api-1': resource('Sample API App') }, existing);
    expect(result.dependencies).toEqual({
      OtherThing: { AppName: 'other-thing' },
      SampleAPIApp: { AppName: 'Sample API App' },
    });
  });

  it('reuses an existing dependency key that already points at the same application, adding nothing', () => {
    const existing = { my_api: { AppName: 'Sample API App' } };
    const result = deriveApplicationDependencies([perm('api-1')], { 'api-1': resource('Sample API App') }, existing);

    expect(result.derived).toEqual([]);
    expect(result.dependencies).toEqual({ my_api: { AppName: 'Sample API App' } });
    expect(result.resourceAppIdRewrites['api-1']).toBe('{{ dependency_refs.my_api.applicationId }}');
  });

  it('falls back to the appId as the key when the preferred key is already taken by a different application', () => {
    const existing = { SampleAPIApp: { AppName: 'a-different-folder' } };
    const result = deriveApplicationDependencies([perm('api-1')], { 'api-1': resource('Sample API App') }, existing);

    expect(result.dependencies['api-1']).toEqual({ AppName: 'Sample API App' });
    expect(result.resourceAppIdRewrites['api-1']).toBe('{{ dependency_refs.api-1.applicationId }}');
  });
});
