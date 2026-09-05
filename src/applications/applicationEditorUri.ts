import * as vscode from 'vscode';

/**
 * The URI scheme `ApplicationEditorProvider` (a `vscode.CustomEditorProvider`) is registered
 * under — distinct from `applicationDocumentUri.ts`'s `entra-application` scheme (the plain
 * combined-YAML text document) so the two editing surfaces never collide over the same URI. VS
 * Code opens a custom editor by URI + view type, so an application folder still needs a virtual
 * URI identity here too, encoded the same way.
 */
export const APPLICATION_EDITOR_SCHEME = 'entra-application-editor';

/**
 * The real folder URI is carried in the query string, not the path. A Custom Editor's tab title
 * is always derived by VS Code from the document URI's path basename — `webviewPanel.title` can't
 * override it (a known VS Code limitation, not an oversight here: see
 * https://github.com/microsoft/vscode/issues/160543) — so the path is kept to just the plain
 * application name (folders under `<artifactsRoot>/applications/` are already named after the
 * application — see `ApplicationsBranch` — so no extra lookup is needed to get it) purely so the
 * tab reads e.g. "sample-web-app" instead of a URL-encoded full folder URI.
 */
function applicationNameFromFolderUri(folderUri: vscode.Uri): string {
  return folderUri.path.split('/').filter(Boolean).pop() ?? folderUri.toString();
}

/** Builds the virtual URI identifying an application folder's structured (Custom Editor) view. */
export function toApplicationEditorUri(folderUri: vscode.Uri): vscode.Uri {
  const name = applicationNameFromFolderUri(folderUri);
  return vscode.Uri.from({
    scheme: APPLICATION_EDITOR_SCHEME,
    path: `/${encodeURIComponent(name)}`,
    query: encodeURIComponent(folderUri.toString()),
  });
}

/** The inverse of `toApplicationEditorUri` — recovers the real application folder URI. */
export function fromApplicationEditorUri(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.parse(decodeURIComponent(uri.query));
}
