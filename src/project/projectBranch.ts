import * as vscode from 'vscode';

export class ProjectRootItem extends vscode.TreeItem {
  constructor() {
    super('Project', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'projectRoot';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class ProjectEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No artifacts downloaded yet', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'projectEmptyPlaceholder';
  }
}

/**
 * UC029/UC033 — supplies the children of the Project root. Reading the local artifacts folder
 * and rendering per-category folders (UC033 main flow) lands with the download feature; this is
 * an empty-state stub until then, per the base-structure + Add Connection/Authenticate scope of
 * this change.
 */
export class ProjectBranch {
  async getChildren(): Promise<vscode.TreeItem[]> {
    return [new ProjectEmptyPlaceholderItem()];
  }
}
