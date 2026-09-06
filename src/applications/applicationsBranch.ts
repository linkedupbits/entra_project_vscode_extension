import * as vscode from 'vscode';
import { getApplicationsRootUri } from '../workspacePaths';

export class ApplicationsRootItem extends vscode.TreeItem {
  constructor() {
    super('Applications', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'applicationsRoot';
    this.iconPath = new vscode.ThemeIcon('package');
  }
}

/**
 * One node per subfolder of `<artifactsRoot>/Applications/` (UC040) — a leaf, not a folder: it
 * does not expand to show its four backing files (that was UC041's original design; removed in
 * favor of always going straight to UC042's structured view). Its four files remain reachable
 * individually only by opening them directly outside the tree (e.g. VS Code's file explorer).
 */
export class ApplicationItem extends vscode.TreeItem {
  constructor(
    public readonly folderUri: vscode.Uri,
    name: string
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'application';
    this.resourceUri = folderUri;
    // UC042 — clicking the application itself opens the structured webview, not a raw file.
    this.command = { command: 'entra.viewApplication', title: 'View Application', arguments: [{ folderUri, name }] };
  }
}

class ApplicationsEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No applications defined yet', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'applicationsEmptyPlaceholder';
  }
}

async function readDirectorySafe(uri: vscode.Uri): Promise<Array<[string, vscode.FileType]>> {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return [];
    }
    throw err;
  }
}

/** UC040/UC041 — browses `<artifactsRoot>/Applications/`, purely local, no auth. */
export class ApplicationsBranch {
  async getChildren(): Promise<vscode.TreeItem[]> {
    const root = getApplicationsRootUri();
    if (!root) {
      return [new ApplicationsEmptyPlaceholderItem()];
    }
    const names = await this.listApplicationNames();
    if (names.length === 0) {
      return [new ApplicationsEmptyPlaceholderItem()];
    }
    return names.map((name) => new ApplicationItem(vscode.Uri.joinPath(root, name), name));
  }

  /**
   * All application folder names under the applications root — used by UC042's Dependencies
   * picker (see ApplicationEditorProvider), not by the tree itself, which uses getChildren() instead.
   */
  async listApplicationNames(): Promise<string[]> {
    const root = getApplicationsRootUri();
    if (!root) {
      return [];
    }
    const entries = await readDirectorySafe(root);
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));
  }
}
