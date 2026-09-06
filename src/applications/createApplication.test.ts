import { describe, it, expect, vi } from 'vitest';
import { ApplicationStore } from './applicationStore';
import { ApplicationFiles, emptyApplicationFields, emptyServicePrincipalFields } from './types';
import { createApplication, isValidApplicationName } from './createApplication';

vi.mock('../workspacePaths', () => ({ getApplicationsRootUri: vi.fn() }));
import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/Applications', toString: () => '/repo/entra/Applications' };

function fakeStore() {
  const save = vi.fn(async (_folderUri: unknown, _files: ApplicationFiles) => {});
  return { store: { save } as unknown as ApplicationStore, save };
}

describe('isValidApplicationName', () => {
  it.each(['sample-web-app', 'Sample App', 'app.v2', ' padded '])('accepts %j', (name) => {
    expect(isValidApplicationName(name)).toBe(true);
  });

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b'])('rejects %j', (name) => {
    expect(isValidApplicationName(name)).toBe(false);
  });
});

describe('createApplication', () => {
  it('returns invalidName without touching the store for a name with a path separator', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    expect(await createApplication(store, [], 'a/b')).toEqual({ kind: 'invalidName' });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns noWorkspace when there is no applications root', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(undefined);
    const { store } = fakeStore();

    expect(await createApplication(store, [], 'new-app')).toEqual({ kind: 'noWorkspace' });
  });

  it('returns alreadyExists (trimmed) when the name is already present', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    expect(await createApplication(store, ['new-app'], '  new-app  ')).toEqual({ kind: 'alreadyExists' });
    expect(save).not.toHaveBeenCalled();
  });

  it('writes the four empty files through the store and reports the new folder', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const { store, save } = fakeStore();

    const result = await createApplication(store, ['other'], '  new-app  ');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.name).toBe('new-app');
      expect(result.folderUri.fsPath).toBe('/repo/entra/Applications/new-app');
    }
    const [savedFolderUri, savedFiles] = save.mock.calls[0];
    expect((savedFolderUri as { fsPath: string }).fsPath).toBe('/repo/entra/Applications/new-app');
    expect(savedFiles.appConfig.application_name).toBe('new-app');
    expect(savedFiles.appConfig.Environments).toEqual([]);
    expect(savedFiles.appConfig.Dependencies).toEqual({});
    expect(savedFiles.application).toEqual(emptyApplicationFields());
    expect(savedFiles.federatedCredentials).toEqual([]);
    expect(savedFiles.servicePrincipal).toEqual(emptyServicePrincipalFields());
  });
});
