import { describe, it, expect } from 'vitest';
import { deriveApplicationDependencies } from './applicationDependencies';
import { RequiredPermission } from '../applications/types';
import { GraphResourceApplication } from '../graph/graphClient';

const GRAPH = '00000003-0000-0000-c000-000000000000';

function perm(resourceAppId: string, id = 'p', type: RequiredPermission['type'] = 'Scope'): RequiredPermission {
  return { resourceAppId, id, type };
}

function resource(
  displayName: string,
  permissions: GraphResourceApplication['permissions'] = {},
  tags: string[] = []
): GraphResourceApplication {
  return { displayName, tags, permissions };
}

describe('deriveApplicationDependencies', () => {
  it('ignores Microsoft Graph permissions entirely', () => {
    const result = deriveApplicationDependencies([perm(GRAPH, 'a'), perm(GRAPH, 'b')], {}, {});
    expect(result.derived).toEqual([]);
    expect(result.dependencies).toEqual({});
    expect(result.requiredPermissions).toEqual([perm(GRAPH, 'a'), perm(GRAPH, 'b')]);
  });

  it('ignores blank resourceAppIds', () => {
    const result = deriveApplicationDependencies([perm('')], {}, {});
    expect(result.derived).toEqual([]);
    expect(result.requiredPermissions).toEqual([perm('')]);
  });

  it('derives one dependency per distinct non-Graph resource, keyed by its squashed display name', () => {
    const resources = { 'api-1': resource('Sample API App') };
    const result = deriveApplicationDependencies([perm('api-1', 'x'), perm('api-1', 'y'), perm(GRAPH)], resources, {});

    expect(result.derived).toEqual([
      { key: 'SampleAPIApp', appName: 'Sample API App', resourceAppId: 'api-1', resolved: true },
    ]);
    expect(result.dependencies).toEqual({ SampleAPIApp: { AppName: 'Sample API App' } });
  });

  it('rewrites a recognised dependency row: resourceAppId to a dependency_refs reference, id to the scope value', () => {
    const resources = {
      'api-1': resource('Sample API App', { 'scope-guid': { name: 'access_as_user', type: 'Scope' } }),
    };
    const result = deriveApplicationDependencies([perm('api-1', 'scope-guid'), perm(GRAPH, 'graph-guid')], resources, {});

    expect(result.requiredPermissions).toEqual([
      { resourceAppId: '{{ dependency_refs.SampleAPIApp.applicationId }}', id: 'access_as_user', type: 'Scope' },
      { resourceAppId: GRAPH, id: 'graph-guid', type: 'Scope' },
    ]);
  });

  it('keeps the original id when the dependency resource does not expose that permission', () => {
    const resources = { 'api-1': resource('Sample API App', {}) };
    const result = deriveApplicationDependencies([perm('api-1', 'unknown-guid')], resources, {});

    expect(result.requiredPermissions).toEqual([
      { resourceAppId: '{{ dependency_refs.SampleAPIApp.applicationId }}', id: 'unknown-guid', type: 'Scope' },
    ]);
  });

  it('keys an unresolved resource by its appId and leaves the permission id untouched', () => {
    const result = deriveApplicationDependencies([perm('mystery-api', 'some-guid')], {}, {});
    expect(result.derived).toEqual([
      { key: 'mystery-api', appName: 'mystery-api', resourceAppId: 'mystery-api', resolved: false },
    ]);
    expect(result.dependencies).toEqual({ 'mystery-api': { AppName: 'mystery-api' } });
    expect(result.requiredPermissions).toEqual([
      { resourceAppId: '{{ dependency_refs.mystery-api.applicationId }}', id: 'some-guid', type: 'Scope' },
    ]);
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
    const resources = { 'api-1': resource('Sample API App', { 'scope-guid': { name: 'access_as_user', type: 'Scope' } }) };
    const result = deriveApplicationDependencies([perm('api-1', 'scope-guid')], resources, existing);

    expect(result.derived).toEqual([]);
    expect(result.dependencies).toEqual({ my_api: { AppName: 'Sample API App' } });
    expect(result.requiredPermissions).toEqual([
      { resourceAppId: '{{ dependency_refs.my_api.applicationId }}', id: 'access_as_user', type: 'Scope' },
    ]);
  });

  it('falls back to the appId as the key when the preferred key is already taken by a different application', () => {
    const existing = { SampleAPIApp: { AppName: 'a-different-folder' } };
    const result = deriveApplicationDependencies([perm('api-1')], { 'api-1': resource('Sample API App') }, existing);

    expect(result.dependencies['api-1']).toEqual({ AppName: 'Sample API App' });
    expect(result.requiredPermissions[0].resourceAppId).toBe('{{ dependency_refs.api-1.applicationId }}');
  });

  it('stores just the <AppName> part when the resource carries an AppName:<Env>_<BU>_<AppName> tag', () => {
    const resources = {
      'api-1': resource('Sample API App', {}, ['AppName:prod_Platform_sample-api', 'Environment:prod']),
    };
    const result = deriveApplicationDependencies([perm('api-1')], resources, {});

    expect(result.dependencies).toEqual({ sampleapi: { AppName: 'sample-api' } });
    expect(result.requiredPermissions[0].resourceAppId).toBe('{{ dependency_refs.sampleapi.applicationId }}');
  });

  it('parses a 3-part display name when there is no AppName: tag', () => {
    const resources = { 'api-1': resource('prod_Platform_sample-api') };
    const result = deriveApplicationDependencies([perm('api-1')], resources, {});

    expect(result.dependencies).toEqual({ sampleapi: { AppName: 'sample-api' } });
  });

  it('keeps the full display name when it is not in 3-part form and there is no tag', () => {
    const resources = { 'api-1': resource('Sample API App') };
    const result = deriveApplicationDependencies([perm('api-1')], resources, {});

    expect(result.dependencies).toEqual({ SampleAPIApp: { AppName: 'Sample API App' } });
  });
});
