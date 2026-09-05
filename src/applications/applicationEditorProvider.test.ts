import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { ApplicationEditorProvider } from './applicationEditorProvider';
import { toApplicationEditorUri } from './applicationEditorUri';
import { getHtml } from './applicationEditorHtml';
import { buildPermissionOptionsByResourceAppId } from './permissionIdOptions';
import { ApplicationStore } from './applicationStore';
import { ApplicationsBranch } from './applicationsBranch';
import { ApplicationFormInput } from './applicationFormLogic';
import { ApplicationFiles, emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from './types';

vi.mock('./applicationEditorHtml', () => ({
  getHtml: vi.fn(() => '<html></html>'),
}));

vi.mock('./permissionIdOptions', () => ({
  buildPermissionOptionsByResourceAppId: vi.fn(async () => ({})),
}));

const folderUri = vscode.Uri.parse('file:///repo/entra/applications/sample-web-app') as unknown as vscode.Uri;

const sampleFiles: ApplicationFiles = {
  appConfig: { ...emptyAppConfig(), application_name: 'sample-web-app' },
  application: { ...emptyApplicationFields(), displayName: 'Sample Web App' },
  federatedCredentials: [],
  servicePrincipal: emptyServicePrincipalFields(),
};

function validInput(overrides: Partial<ApplicationFormInput> = {}): ApplicationFormInput {
  return {
    application_name: 'sample-web-app',
    business_unit: '',
    variables: [],
    environments: [],
    dependencies: [],
    application: {
      displayName: 'Sample Web App',
      signInAudience: 'AzureADMyOrg',
      requiredPermissions: [],
      oauth2PermissionScopes: [],
    },
    federatedCredentials: [],
    servicePrincipal: { appId: '', appRoleAssignmentRequired: false, tags: [] },
    ...overrides,
  };
}

function fakeStore(files: ApplicationFiles = sampleFiles) {
  const save = vi.fn(async (_folderUri: vscode.Uri, _files: ApplicationFiles) => {});
  const store = {
    load: vi.fn(async () => files),
    save,
  } as unknown as ApplicationStore;
  return { store, save };
}

function fakeApplicationsBranch(names: string[] = ['sample-web-app', 'other-app']) {
  return {
    listApplicationNames: vi.fn(async () => names),
  } as unknown as ApplicationsBranch;
}

function fakePanel() {
  const listeners: Array<(message: unknown) => void> = [];
  const disposeListeners: Array<() => void> = [];
  return {
    webview: {
      options: {},
      html: '',
      onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
        listeners.push(listener);
        return { dispose: vi.fn() };
      }),
      postMessage: vi.fn(),
      emit(message: unknown): void {
        for (const listener of listeners) listener(message);
      },
    },
    onDidDispose: vi.fn((listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: vi.fn() };
    }),
  } as unknown as vscode.WebviewPanel & { webview: { emit(message: unknown): void } };
}

beforeEach(() => {
  vi.mocked(vscode.commands.executeCommand).mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.workspace.fs.writeFile).mockReset();
  vi.mocked(vscode.workspace.fs.delete).mockReset();
  vi.mocked(getHtml).mockClear();
  vi.mocked(buildPermissionOptionsByResourceAppId).mockClear();
});

describe('ApplicationEditorProvider', () => {
  describe('openCustomDocument', () => {
    it('loads the application folder via ApplicationStore and resolves its name from the editor URI', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);

      const document = await provider.openCustomDocument(uri);

      expect(store.load).toHaveBeenCalled();
      expect(document.name).toBe('sample-web-app');
      expect(document.folderUri.toString()).toBe(folderUri.toString());
      expect(document.initialFiles).toEqual(sampleFiles);
    });
  });

  describe('resolveCustomEditor', () => {
    it('renders the webview with html from getHtml, excluding the document itself from dependency options', async () => {
      const { store } = fakeStore();
      const branch = fakeApplicationsBranch(['sample-web-app', 'other-app']);
      const provider = new ApplicationEditorProvider(store, branch);
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();

      await provider.resolveCustomEditor(document, panel);

      expect(panel.webview.options).toEqual({ enableScripts: true });
      expect(getHtml).toHaveBeenCalledWith('sample-web-app', sampleFiles, ['other-app'], {});
      expect(panel.webview.html).toBe('<html></html>');
    });

    it('marks the document dirty and does not trigger a save on an edit message', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      const changeListener = vi.fn();
      provider.onDidChangeCustomDocument(changeListener);
      await provider.resolveCustomEditor(document, panel);

      const input = validInput({ business_unit: 'finance' });
      panel.webview.emit({ type: 'edit', input });
      await Promise.resolve();

      expect(document.pendingInput).toEqual(input);
      expect(changeListener).toHaveBeenCalledWith({ document });
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.files.save');
    });

    it('marks the document dirty and asks VS Code to save on a submit message', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      await provider.resolveCustomEditor(document, panel);

      const input = validInput();
      panel.webview.emit({ type: 'submit', input });
      await Promise.resolve();

      expect(document.pendingInput).toEqual(input);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.save');
    });

    it('asks VS Code to revert the document on a cancel message, without marking it dirty', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      const changeListener = vi.fn();
      provider.onDidChangeCustomDocument(changeListener);
      await provider.resolveCustomEditor(document, panel);

      panel.webview.emit({ type: 'cancel' });
      await Promise.resolve();

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
      expect(document.pendingInput).toBeUndefined();
      expect(changeListener).not.toHaveBeenCalled();
    });
  });

  describe('saveCustomDocument', () => {
    it('does nothing when there is no pending input', async () => {
      const { store, save } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);

      await provider.saveCustomDocument(document);

      expect(save).not.toHaveBeenCalled();
    });

    it('resolves, saves, and clears the pending input on a valid submission', async () => {
      const { store, save } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      document.pendingInput = validInput({ application_name: 'sample-web-app', business_unit: 'finance' });

      await provider.saveCustomDocument(document);

      expect(save).toHaveBeenCalledTimes(1);
      const [savedFolderUri, savedFiles] = save.mock.calls[0];
      expect(savedFolderUri.toString()).toBe(folderUri.toString());
      expect(savedFiles.appConfig.business_unit).toBe('finance');
      expect(document.pendingInput).toBeUndefined();
      expect(document.initialFiles).toBe(savedFiles);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Saved application "sample-web-app".');
    });

    it('posts the validation error to the webview and throws, without saving, on an invalid submission', async () => {
      const { store, save } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      await provider.resolveCustomEditor(document, panel);
      document.pendingInput = validInput({ application_name: '' });

      await expect(provider.saveCustomDocument(document)).rejects.toThrow(/validation errors/);

      expect(save).not.toHaveBeenCalled();
      expect(panel.webview.postMessage).toHaveBeenCalledWith({ kind: 'missingApplicationName' });
    });
  });

  describe('saveCustomDocumentAs', () => {
    it('throws — an application definition cannot be saved to another location', () => {
      const provider = new ApplicationEditorProvider(fakeStore().store, fakeApplicationsBranch());
      expect(() => provider.saveCustomDocumentAs()).toThrow(/Save As is not supported/);
    });
  });

  describe('revertCustomDocument', () => {
    it('reloads from disk, clears pending input, and re-renders the open panel', async () => {
      const reloadedFiles: ApplicationFiles = { ...sampleFiles, appConfig: { ...sampleFiles.appConfig, business_unit: 'reloaded' } };
      const store = {
        load: vi.fn().mockResolvedValueOnce(sampleFiles).mockResolvedValueOnce(reloadedFiles),
        save: vi.fn(),
      } as unknown as ApplicationStore;
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      await provider.resolveCustomEditor(document, panel);
      document.pendingInput = validInput();
      vi.mocked(getHtml).mockClear();

      await provider.revertCustomDocument(document);

      expect(document.initialFiles).toEqual(reloadedFiles);
      expect(document.pendingInput).toBeUndefined();
      expect(getHtml).toHaveBeenCalledWith('sample-web-app', reloadedFiles, expect.anything(), expect.anything());
    });

    it('does not attempt to re-render when no panel is currently open for the document', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);

      await expect(provider.revertCustomDocument(document)).resolves.toBeUndefined();
    });
  });

  describe('backupCustomDocument', () => {
    it('backs up the last-saved files when there is no pending input', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const destination = vscode.Uri.parse('file:///tmp/backup-1') as unknown as vscode.Uri;

      const backup = await provider.backupCustomDocument(document, { destination } as vscode.CustomDocumentBackupContext);

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(destination, expect.any(Buffer));
      const [, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(Buffer.from(bytes as Buffer).toString('utf8')).toContain('application_name: sample-web-app');
      expect(backup.id).toBe(destination.toString());
    });

    it('backs up the pending (unsaved) input when it resolves successfully', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      document.pendingInput = validInput({ business_unit: 'pending-value' });
      const destination = vscode.Uri.parse('file:///tmp/backup-2') as unknown as vscode.Uri;

      await provider.backupCustomDocument(document, { destination } as vscode.CustomDocumentBackupContext);

      const [, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(Buffer.from(bytes as Buffer).toString('utf8')).toContain('business_unit: pending-value');
    });

    it('falls back to the last-saved files when the pending input fails validation', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      document.pendingInput = validInput({ application_name: '' });
      const destination = vscode.Uri.parse('file:///tmp/backup-3') as unknown as vscode.Uri;

      await provider.backupCustomDocument(document, { destination } as vscode.CustomDocumentBackupContext);

      const [, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(Buffer.from(bytes as Buffer).toString('utf8')).toContain('application_name: sample-web-app');
    });

    it('deletes the backup file, tolerating it already being gone', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const destination = vscode.Uri.parse('file:///tmp/backup-4') as unknown as vscode.Uri;
      vi.mocked(vscode.workspace.fs.delete).mockRejectedValueOnce(new Error('already gone'));

      const backup = await provider.backupCustomDocument(document, { destination } as vscode.CustomDocumentBackupContext);
      await expect(backup.delete()).resolves.toBeUndefined();

      expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(destination);
    });
  });

  describe('panel lifecycle', () => {
    it('stops tracking the panel once it is disposed', async () => {
      const { store } = fakeStore();
      const provider = new ApplicationEditorProvider(store, fakeApplicationsBranch());
      const uri = toApplicationEditorUri(folderUri);
      const document = await provider.openCustomDocument(uri);
      const panel = fakePanel();
      await provider.resolveCustomEditor(document, panel);
      const disposeListener = vi.mocked(panel.onDidDispose).mock.calls[0][0] as () => void;
      vi.mocked(getHtml).mockClear();

      disposeListener();
      await provider.revertCustomDocument(document);

      expect(getHtml).not.toHaveBeenCalled();
    });
  });
});
