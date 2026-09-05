import * as vscode from 'vscode';
import { ApplicationsBranch } from './applicationsBranch';
import { ApplicationStore } from './applicationStore';
import { resolveApplicationSubmit, ApplicationFormInput } from './applicationFormLogic';
import { ApplicationFiles } from './types';
import { buildApplicationDocumentText } from './applicationDocumentContent';
import { fromApplicationEditorUri } from './applicationEditorUri';
import { getHtml } from './applicationEditorHtml';

interface EditMessage {
  type: 'edit';
  input: ApplicationFormInput;
}
interface SubmitMessage {
  type: 'submit';
  input: ApplicationFormInput;
}
interface CancelMessage {
  type: 'cancel';
}
type IncomingMessage = EditMessage | SubmitMessage | CancelMessage;

/**
 * UC042 — a structured, editable view of one application's four files (UC040), replacing
 * separately opening each raw file. Its `pendingInput` holds the latest unsaved form snapshot
 * (from an `edit` message — see `ApplicationEditorProvider`'s webview script), `undefined` when
 * there's nothing unsaved; `initialFiles` is what's actually on disk as of the last load/save.
 */
class ApplicationCustomDocument implements vscode.CustomDocument {
  pendingInput: ApplicationFormInput | undefined;

  constructor(
    public readonly uri: vscode.Uri,
    public readonly folderUri: vscode.Uri,
    public readonly name: string,
    public initialFiles: ApplicationFiles
  ) {}

  dispose(): void {
    // No resources of our own to release — the webview panel's own disposal is handled by VS Code.
  }
}

/**
 * UC042 — a VS Code Custom Editor (not a plain WebviewPanel) specifically so the tab shows VS
 * Code's native "unsaved changes" indicator and participates in its native save/revert/close
 * flows, the same as any other editable document — this was the whole reason for this class
 * existing rather than the simpler `ApplicationFormPanel` it replaces. Saving serializes all four
 * files back to disk as YAML — see `ApplicationStore` for the accepted comment/anchor/
 * unmodelled-field loss this implies.
 *
 * Deliberate simplifications versus a "complete" Custom Editor:
 * - Dirty-tracking uses `CustomDocumentContentChangeEvent` (just `{ document }`), not
 *   `CustomDocumentEditEvent` — no undo/redo stack integration. A multi-field form's "edits" don't
 *   map cleanly onto a single linear undo stack anyway; VS Code's own Ctrl+Z inside individual
 *   text inputs still works as normal browser undo, it just doesn't span field boundaries.
 * - `saveCustomDocumentAs` isn't supported (throws) — an application definition's identity *is*
 *   its folder; "save a copy elsewhere" isn't a meaningful operation on this format.
 */
export class ApplicationEditorProvider implements vscode.CustomEditorProvider<ApplicationCustomDocument> {
  static readonly viewType = 'entra.applicationEditor';

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<ApplicationCustomDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly store: ApplicationStore,
    private readonly applicationsBranch: ApplicationsBranch
  ) {}

  async openCustomDocument(uri: vscode.Uri): Promise<ApplicationCustomDocument> {
    const folderUri = fromApplicationEditorUri(uri);
    // The editor URI's path is exactly the (encoded) application name — see applicationEditorUri.ts —
    // so decoding it directly avoids re-deriving the name from the folder URI a second way.
    const name = decodeURIComponent(uri.path.replace(/^\//, ''));
    const initialFiles = await this.store.load(folderUri);
    return new ApplicationCustomDocument(uri, folderUri, name, initialFiles);
  }

  async resolveCustomEditor(document: ApplicationCustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };
    this.panels.set(document.uri.toString(), webviewPanel);
    webviewPanel.onDidDispose(() => this.panels.delete(document.uri.toString()));
    webviewPanel.webview.onDidReceiveMessage((message: IncomingMessage) => void this.handleMessage(document, message));
    await this.render(document, webviewPanel);
  }

  private async render(document: ApplicationCustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    const allNames = await this.applicationsBranch.listApplicationNames();
    const dependencyAppOptions = allNames.filter((n) => n !== document.name);
    panel.webview.html = getHtml(document.name, document.initialFiles, dependencyAppOptions);
  }

  private async handleMessage(document: ApplicationCustomDocument, message: IncomingMessage): Promise<void> {
    if (message.type === 'cancel') {
      void vscode.commands.executeCommand('workbench.action.files.revert');
      return;
    }
    // 'edit' and 'submit' both carry the latest full form snapshot — record it and mark the
    // document dirty either way; 'submit' additionally asks VS Code to save right now (the
    // in-webview Save button's click), reusing the exact same native save flow Ctrl+S does.
    document.pendingInput = message.input;
    this._onDidChangeCustomDocument.fire({ document });
    if (message.type === 'submit') {
      void vscode.commands.executeCommand('workbench.action.files.save');
    }
  }

  async saveCustomDocument(document: ApplicationCustomDocument): Promise<void> {
    const input = document.pendingInput;
    if (!input) {
      return;
    }
    const resolution = resolveApplicationSubmit(input);
    if (resolution.kind !== 'ok') {
      this.panels.get(document.uri.toString())?.webview.postMessage(resolution);
      throw new Error(`Could not save application "${document.name}": it has validation errors — see the form.`);
    }
    await this.store.save(document.folderUri, resolution.files);
    document.initialFiles = resolution.files;
    document.pendingInput = undefined;
    void vscode.window.showInformationMessage(`Saved application "${document.name}".`);
  }

  saveCustomDocumentAs(): Thenable<void> {
    throw new Error('Save As is not supported for application definitions.');
  }

  async revertCustomDocument(document: ApplicationCustomDocument): Promise<void> {
    document.initialFiles = await this.store.load(document.folderUri);
    document.pendingInput = undefined;
    const panel = this.panels.get(document.uri.toString());
    if (panel) {
      await this.render(document, panel);
    }
  }

  async backupCustomDocument(
    document: ApplicationCustomDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    const resolution = document.pendingInput ? resolveApplicationSubmit(document.pendingInput) : undefined;
    const files = resolution?.kind === 'ok' ? resolution.files : document.initialFiles;
    await vscode.workspace.fs.writeFile(context.destination, Buffer.from(buildApplicationDocumentText(files), 'utf8'));
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // Already gone — nothing to clean up.
        }
      },
    };
  }
}
