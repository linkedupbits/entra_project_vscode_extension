import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { FileSystemError } from '../test/vscodeMock';
import { ApplicationDocumentProvider } from './applicationDocumentProvider';
import { toApplicationDocumentUri } from './applicationDocumentUri';
import { ApplicationStore } from './applicationStore';
import { ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from './types';

const folderUri = vscode.Uri.parse('file:///repo/entra/applications/sample-web-app') as unknown as vscode.Uri;

const sampleFiles: ApplicationFiles = {
  appConfig: { ...emptyAppConfig(), application_name: 'sample-web-app' },
  application: { ...emptyApplicationFields(), displayName: 'Sample Web App' },
  federatedCredentials: [],
  servicePrincipal: emptyServicePrincipalFields(),
};

function fakeStore(files: ApplicationFiles = sampleFiles) {
  const save = vi.fn(async (_folderUri: vscode.Uri, _files: ApplicationFiles) => {});
  const store = {
    load: vi.fn(async () => files),
    save,
  } as unknown as ApplicationStore;
  return { store, save };
}

describe('ApplicationDocumentProvider', () => {
  describe('readFile', () => {
    it('loads the application folder via ApplicationStore and returns the combined document as bytes', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);

      const bytes = await provider.readFile(documentUri);

      expect(store.load).toHaveBeenCalledWith(expect.objectContaining({ toString: expect.any(Function) }));
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('application_name: sample-web-app');
      expect(text).toContain('displayName: Sample Web App');
    });

    it('resolves the real folder URI from the virtual document URI when loading', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);

      await provider.readFile(documentUri);

      const loadedFolderUri = vi.mocked(store.load).mock.calls[0][0];
      expect(loadedFolderUri.toString()).toBe(folderUri.toString());
    });
  });

  describe('writeFile', () => {
    it('parses the written text and saves it through ApplicationStore', async () => {
      const { store, save } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);
      const text = await provider.readFile(documentUri);

      await provider.writeFile(documentUri, text);

      expect(save).toHaveBeenCalledTimes(1);
      const [savedFolderUri, savedFiles] = save.mock.calls[0];
      expect(savedFolderUri.toString()).toBe(folderUri.toString());
      expect(savedFiles).toEqual(sampleFiles);
    });

    it('fires an onDidChangeFile event after a successful save', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      await provider.writeFile(documentUri, Buffer.from('AppConfig: {}', 'utf8'));

      expect(listener).toHaveBeenCalledWith([{ type: vscode.FileChangeType.Changed, uri: documentUri }]);
    });

    it('throws a FileSystemError, without saving, when the written text is not valid YAML', async () => {
      const { store, save } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);

      await expect(provider.writeFile(documentUri, Buffer.from('[not: valid: yaml', 'utf8'))).rejects.toThrow();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('stat', () => {
    it('reports a File type with a size matching the current content', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      const documentUri = toApplicationDocumentUri(folderUri);

      const stat = await provider.stat(documentUri);

      expect(stat.type).toBe(vscode.FileType.File);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  describe('watch', () => {
    it('returns a disposable that can be disposed without error', () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);

      const disposable = provider.watch();

      expect(() => disposable.dispose()).not.toThrow();
    });
  });

  describe('unsupported directory-style operations', () => {
    it('readDirectory throws NoPermissions', () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      expect(() => provider.readDirectory()).toThrow(FileSystemError);
    });

    it('createDirectory throws NoPermissions', () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      expect(() => provider.createDirectory()).toThrow(FileSystemError);
    });

    it('delete throws NoPermissions', () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      expect(() => provider.delete()).toThrow(FileSystemError);
    });

    it('rename throws NoPermissions', () => {
      const { store } = fakeStore();
      const provider = new ApplicationDocumentProvider(store);
      expect(() => provider.rename()).toThrow(FileSystemError);
    });
  });
});
