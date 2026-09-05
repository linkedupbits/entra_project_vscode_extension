import * as vscode from 'vscode';

/**
 * The URI scheme `ApplicationDocumentProvider` (a `vscode.FileSystemProvider`) is registered
 * under — one virtual document per application folder, letting a project application be opened
 * and edited as a normal, savable text editor tab (see UC041) alongside UC042's structured
 * webview, rather than replacing it.
 */
export const APPLICATION_DOCUMENT_SCHEME = 'entra-application';

/**
 * Builds the virtual document URI for an application folder. The real folder URI is embedded,
 * encoded, in the virtual URI's path (rather than assumed to be a `file:` URI reconstructed with
 * `vscode.Uri.file()`) so this keeps working under any workspace URI scheme (e.g. a remote/SSH
 * workspace). The `.yaml` suffix is purely cosmetic — it's what lets VS Code pick YAML syntax
 * highlighting for the opened editor, the same trick a real `.yaml` file gets for free.
 */
export function toApplicationDocumentUri(folderUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.from({
    scheme: APPLICATION_DOCUMENT_SCHEME,
    path: `/${encodeURIComponent(folderUri.toString())}.yaml`,
  });
}

/** The inverse of `toApplicationDocumentUri` — recovers the real application folder URI from a virtual document URI. */
export function fromApplicationDocumentUri(uri: vscode.Uri): vscode.Uri {
  const encoded = uri.path.replace(/^\//, '').replace(/\.yaml$/, '');
  return vscode.Uri.parse(decodeURIComponent(encoded));
}
