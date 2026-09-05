import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listApplications, getApplication } from './graphClient';

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
