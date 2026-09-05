import * as vscode from 'vscode';
import { ApplicationStore } from './applicationStore';
import { buildApplicationDocumentText, parseApplicationDocumentText } from './applicationDocumentContent';
import { fromApplicationDocumentUri } from './applicationDocumentUri';

/**
 * Backs `entra-application:` virtual documents (see `applicationDocumentUri.ts`): a normal,
 * savable VS Code text editor tab per application folder, showing all four of UC040's files
 * combined as one editable YAML document. This is a second, text-based editing surface alongside
 * UC042's structured webview — not a replacement for it; both write through the same
 * `ApplicationStore`, so either one's save is immediately reflected by the other.
 *
 * Scoped deliberately to exactly what this single-document-per-application use needs:
 * `readDirectory`/`createDirectory`/`delete`/`rename` are never actually invoked by VS Code for
 * how this provider is used (always addressed by a specific document URI, never asked to list a
 * "directory" under this scheme), so they throw rather than pretending to support directory
 * semantics this scheme doesn't have.
 */
export class ApplicationDocumentProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly store: ApplicationStore) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const content = await this.readFile(uri);
    const now = Date.now();
    return { type: vscode.FileType.File, ctime: now, mtime: now, size: content.byteLength };
  }

  readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions('entra-application: documents are not directories.');
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('entra-application: documents do not support subdirectories.');
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const folderUri = fromApplicationDocumentUri(uri);
    const files = await this.store.load(folderUri);
    return Buffer.from(buildApplicationDocumentText(files), 'utf8');
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const folderUri = fromApplicationDocumentUri(uri);
    const result = parseApplicationDocumentText(Buffer.from(content).toString('utf8'));
    if (result.kind === 'error') {
      throw vscode.FileSystemError.Unavailable(`Could not parse this document as YAML: ${result.message}`);
    }
    await this.store.save(folderUri, result.files);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('entra-application: documents cannot be deleted through the editor.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('entra-application: documents cannot be renamed through the editor.');
  }
}
