import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listApplications,
  getApplication,
  listFederatedIdentityCredentials,
  getServicePrincipalByAppId,
  getResourceApplicationPermissions,
} from './graphClient';

function jsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK'): Response {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('listApplications', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests the correct URL for the cloud, with a bearer token', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await listApplications('a-token', 'public');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/applications?$select=id,appId,displayName',
      { headers: { Authorization: 'Bearer a-token' } }
    );
  });

  it.each([
    ['usGov', 'graph.microsoft.us'],
    ['china', 'microsoftgraph.chinacloudapi.cn'],
  ] as const)('uses the %s cloud host', async (cloud, host) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await listApplications('a-token', cloud);

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`https://${host}/v1.0/applications?$select=id,appId,displayName`);
  });

  it('normalizes a well-formed page of results', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ value: [{ id: 'obj-1', appId: 'app-1', displayName: 'App One' }] })
    );

    const result = await listApplications('a-token', 'public');

    expect(result).toEqual([{ id: 'obj-1', appId: 'app-1', displayName: 'App One' }]);
  });

  it('defaults missing/non-string fields on an entry rather than throwing', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [{ id: 'obj-1' }, 'not an object', 42] }));

    const result = await listApplications('a-token', 'public');

    expect(result).toEqual([
      { id: 'obj-1', appId: '', displayName: '' },
      { id: '', appId: '', displayName: '' },
      { id: '', appId: '', displayName: '' },
    ]);
  });

  it('follows @odata.nextLink until it is absent, concatenating every page', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: '1', appId: 'a1', displayName: 'App One' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/applications?$skiptoken=abc',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [{ id: '2', appId: 'a2', displayName: 'App Two' }] }));

    const result = await listApplications('a-token', 'public');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/applications?$skiptoken=abc');
    expect(result).toEqual([
      { id: '1', appId: 'a1', displayName: 'App One' },
      { id: '2', appId: 'a2', displayName: 'App Two' },
    ]);
  });

  it('throws with the status and body when Graph returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Insufficient privileges' } }, false, 403, 'Forbidden')
    );

    await expect(listApplications('a-token', 'public')).rejects.toThrow(
      /Microsoft Graph returned 403 Forbidden listing applications/
    );
  });

  it('still throws a useful error when the error response body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    await expect(listApplications('a-token', 'public')).rejects.toThrow(
      /Microsoft Graph returned 500 Internal Server Error listing applications\.$/
    );
  });
});

describe('getApplication', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests the application by ID, with a bearer token', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'obj-1', displayName: 'My App' }));

    await getApplication('a-token', 'public', 'obj-1');

    expect(global.fetch).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/applications/obj-1', {
      headers: { Authorization: 'Bearer a-token' },
    });
  });

  it('URL-encodes the application ID', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 'obj/1' }));

    await getApplication('a-token', 'public', 'obj/1');

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/applications/obj%2F1');
  });

  it('returns the full object, stripping @odata.context', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#applications/$entity', id: 'obj-1', displayName: 'My App' })
    );

    const result = await getApplication('a-token', 'public', 'obj-1');

    expect(result).toEqual({ id: 'obj-1', displayName: 'My App' });
  });

  it('throws with the status and body when Graph returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: { message: 'Not found' } }, false, 404, 'Not Found'));

    await expect(getApplication('a-token', 'public', 'obj-1')).rejects.toThrow(
      /Microsoft Graph returned 404 Not Found fetching application "obj-1"/
    );
  });

  it('still throws a useful error when the error response body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    await expect(getApplication('a-token', 'public', 'obj-1')).rejects.toThrow(
      /Microsoft Graph returned 500 Internal Server Error fetching application "obj-1"\.$/
    );
  });
});

describe('listFederatedIdentityCredentials', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests the credentials nested under the application, with a bearer token', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await listFederatedIdentityCredentials('a-token', 'public', 'obj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/applications/obj-1/federatedIdentityCredentials',
      { headers: { Authorization: 'Bearer a-token' } }
    );
  });

  it('URL-encodes the application ID', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await listFederatedIdentityCredentials('a-token', 'public', 'obj/1');

    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      'https://graph.microsoft.com/v1.0/applications/obj%2F1/federatedIdentityCredentials'
    );
  });

  it('returns raw entries unmodified (normalization happens elsewhere)', async () => {
    const entry = { name: 'dev-deploy', issuer: 'https://token.actions.githubusercontent.com' };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [entry] }));

    const result = await listFederatedIdentityCredentials('a-token', 'public', 'obj-1');

    expect(result).toEqual([entry]);
  });

  it('follows @odata.nextLink until it is absent, concatenating every page', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ name: 'a' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/applications/obj-1/federatedIdentityCredentials?$skiptoken=abc',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ value: [{ name: 'b' }] }));

    const result = await listFederatedIdentityCredentials('a-token', 'public', 'obj-1');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('throws with the status and body when Graph returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, false, 403, 'Forbidden'));

    await expect(listFederatedIdentityCredentials('a-token', 'public', 'obj-1')).rejects.toThrow(
      /Microsoft Graph returned 403 Forbidden listing federated identity credentials for application "obj-1"/
    );
  });

  it('still throws a useful error when the error response body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    await expect(listFederatedIdentityCredentials('a-token', 'public', 'obj-1')).rejects.toThrow(
      /Microsoft Graph returned 500 Internal Server Error listing federated identity credentials for application "obj-1"\.$/
    );
  });
});

describe('getServicePrincipalByAppId', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('filters by appId, with a bearer token', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await getServicePrincipalByAppId('a-token', 'public', 'app-1');

    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId%20eq%20'app-1'",
      { headers: { Authorization: 'Bearer a-token' } }
    );
  });

  it('returns the first matching service principal', async () => {
    const sp = { id: 'sp-1', appId: 'app-1', appRoleAssignmentRequired: true };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [sp] }));

    const result = await getServicePrincipalByAppId('a-token', 'public', 'app-1');

    expect(result).toEqual(sp);
  });

  it('returns undefined when no service principal exists for the appId', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    const result = await getServicePrincipalByAppId('a-token', 'public', 'app-1');

    expect(result).toBeUndefined();
  });

  it('throws with the status and body when Graph returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, false, 403, 'Forbidden'));

    await expect(getServicePrincipalByAppId('a-token', 'public', 'app-1')).rejects.toThrow(
      /Microsoft Graph returned 403 Forbidden looking up the service principal for appId "app-1"/
    );
  });

  it('still throws a useful error when the error response body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    await expect(getServicePrincipalByAppId('a-token', 'public', 'app-1')).rejects.toThrow(
      /Microsoft Graph returned 500 Internal Server Error looking up the service principal for appId "app-1"\.$/
    );
  });
});

describe('getResourceApplicationPermissions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests the resource by appId, selecting displayName/appRoles/oauth2PermissionScopes', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    await getResourceApplicationPermissions('a-token', 'public', 'resource-app-1');

    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId%20eq%20'resource-app-1'&$select=displayName,appRoles,oauth2PermissionScopes",
      { headers: { Authorization: 'Bearer a-token' } }
    );
  });

  it('builds a permissions map from appRoles (Role) and oauth2PermissionScopes (Scope)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        value: [
          {
            displayName: 'Some Other API',
            appRoles: [{ id: 'role-1', value: 'Data.ReadWrite.All' }],
            oauth2PermissionScopes: [{ id: 'scope-1', value: 'Data.Read' }],
          },
        ],
      })
    );

    const result = await getResourceApplicationPermissions('a-token', 'public', 'resource-app-1');

    expect(result).toEqual({
      displayName: 'Some Other API',
      permissions: {
        'role-1': { name: 'Data.ReadWrite.All', type: 'Role' },
        'scope-1': { name: 'Data.Read', type: 'Scope' },
      },
    });
  });

  it('returns undefined when no service principal exists for the appId', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [] }));

    const result = await getResourceApplicationPermissions('a-token', 'public', 'resource-app-1');

    expect(result).toBeUndefined();
  });

  it('tolerates missing appRoles/oauth2PermissionScopes arrays, returning an empty permissions map', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [{ displayName: 'Some Other API' }] }));

    const result = await getResourceApplicationPermissions('a-token', 'public', 'resource-app-1');

    expect(result).toEqual({ displayName: 'Some Other API', permissions: {} });
  });

  it('falls back to the resourceAppId as displayName when the field is blank', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ value: [{}] }));

    const result = await getResourceApplicationPermissions('a-token', 'public', 'resource-app-1');

    expect(result?.displayName).toBe('resource-app-1');
  });

  it('throws with the status and body when Graph returns a non-OK response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: { message: 'boom' } }, false, 403, 'Forbidden'));

    await expect(getResourceApplicationPermissions('a-token', 'public', 'resource-app-1')).rejects.toThrow(
      /Microsoft Graph returned 403 Forbidden looking up resource application "resource-app-1"/
    );
  });

  it('still throws a useful error when the error response body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => {
        throw new Error('stream already consumed');
      },
    } as unknown as Response;
    vi.mocked(global.fetch).mockResolvedValueOnce(response);

    await expect(getResourceApplicationPermissions('a-token', 'public', 'resource-app-1')).rejects.toThrow(
      /Microsoft Graph returned 500 Internal Server Error looking up resource application "resource-app-1"\.$/
    );
  });
});
