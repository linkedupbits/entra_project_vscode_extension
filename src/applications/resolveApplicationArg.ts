import * as vscode from 'vscode';
import { getApplicationsRootUri } from '../workspacePaths';
import { ApplicationsBranch } from './applicationsBranch';

export interface ResolvedApplication {
  folderUri: vscode.Uri;
  name: string;
}

/**
 * Resolves which project application a command should act on: the tree item it was invoked from,
 * if any, otherwise a quick-pick over `<artifactsRoot>/Applications/` — so a command (e.g. delete)
 * works from the command palette too, not only a context menu with a pre-selected item. The same
 * pattern as `connections/resolveConnectionArg.ts`.
 */
export async function resolveApplicationArg(
  applicationsBranch: ApplicationsBranch,
  item: { folderUri?: vscode.Uri; name?: string } | undefined,
  placeHolder: string
): Promise<ResolvedApplication | undefined> {
  if (item?.folderUri && item.name) {
    return { folderUri: item.folderUri, name: item.name };
  }
  const root = getApplicationsRootUri();
  const names = await applicationsBranch.listApplicationNames();
  if (!root || names.length === 0) {
    void vscode.window.showInformationMessage('No application definitions found.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(names, { placeHolder });
  return pick ? { folderUri: vscode.Uri.joinPath(root, pick), name: pick } : undefined;
}
