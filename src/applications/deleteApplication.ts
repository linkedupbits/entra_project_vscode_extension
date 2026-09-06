import * as vscode from 'vscode';

/**
 * UC043 — modal confirmation before deleting a project application. Returns true only if the user
 * explicitly chooses **Delete** (Esc / dismiss → false), so a mis-click can't remove a definition.
 */
export async function confirmDeleteApplication(name: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Delete the application definition "${name}"? Its folder and all four files are removed — moved to the trash where the workspace's filesystem supports it, otherwise deleted permanently.`,
    { modal: true },
    'Delete'
  );
  return choice === 'Delete';
}

/**
 * UC043 — removes a project application's whole folder (UC040). Tries the OS trash first (so the
 * delete stays recoverable), but some filesystem providers — dev containers, certain remotes —
 * can't move to trash (`provider does not support it`); in that case it retries as a permanent
 * delete rather than failing outright.
 */
export async function deleteApplication(folderUri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(folderUri, { recursive: true, useTrash: true });
  } catch {
    await vscode.workspace.fs.delete(folderUri, { recursive: true, useTrash: false });
  }
}
