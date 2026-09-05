import * as vscode from 'vscode';
import { getApplicationsRootUri } from '../workspacePaths';

/** The order UC040's four canonical files are listed in; anything else found sorts after, alphabetically. */
const CANONICAL_FILE_ORDER = [
  'AppConfig.yaml',
  'Application.yaml.j2',
  'FederatedCredentials.yaml.j2',
  'ServicePrincipal.yaml.j2',
];

export class ApplicationsRootItem extends vscode.TreeItem {
  constructor() {
    super('Applications', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'applicationsRoot';
    this.iconPath = new vscode.ThemeIcon('package');
  }
}

/** One node per subfolder of `<artifactsRoot>/applications/` (UC040). */
export class ApplicationItem extends vscode.TreeItem {
  constructor(
    public readonly folderUri: vscode.Uri,
    name: string
  ) {
    super(name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'application';
    this.resourceUri = folderUri;
    // UC042 — clicking the application itself opens the structured webview, not a raw file.
    this.command = { command: 'entra.viewApplication', title: 'View Application', arguments: [{ folderUri, name }] };
  }
}

class ApplicationFileItem extends vscode.TreeItem {
  constructor(fileUri: vscode.Uri, name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'applicationFile';
    this.resourceUri = fileUri;
    this.command = { command: 'vscode.open', title: 'Open File', arguments: [fileUri] };
  }
}

class ApplicationsEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No applications defined yet', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'applicationsEmptyPlaceholder';
  }
}

class ApplicationEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No files in this application yet', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'applicationEmptyPlaceholder';
  }
}

function canonicalRank(name: string): number {
  const index = CANONICAL_FILE_ORDER.indexOf(name);
  return index === -1 ? CANONICAL_FILE_ORDER.length : index;
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

/** UC040/UC041 — browses `<artifactsRoot>/applications/`, purely local, no auth. */
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
   * picker (see ApplicationFormPanel), not by the tree itself, which uses getChildren() instead.
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

  async getFiles(application: ApplicationItem): Promise<vscode.TreeItem[]> {
    const entries = await readDirectorySafe(application.folderUri);
    const files = entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .sort((a, b) => canonicalRank(a) - canonicalRank(b) || a.localeCompare(b));

    if (files.length === 0) {
      return [new ApplicationEmptyPlaceholderItem()];
    }
    return files.map((name) => new ApplicationFileItem(vscode.Uri.joinPath(application.folderUri, name), name));
  }
}
