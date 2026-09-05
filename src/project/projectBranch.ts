import * as vscode from 'vscode';
import { ApplicationsBranch, ApplicationsRootItem } from '../applications/applicationsBranch';

export class ProjectRootItem extends vscode.TreeItem {
  constructor() {
    super('Project', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'projectRoot';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

/**
 * UC029/UC033/UC041 — supplies the children of the Project root. Currently just the Applications
 * branch (UC040/UC041); downloaded-artifact category folders (UC033 main flow) land with the
 * download feature. An application item itself is a leaf (see ApplicationsBranch) — it has no
 * children of its own to delegate to, so this branch only ever needs to resolve one level deep.
 */
export class ProjectBranch {
  private readonly applicationsRoot = new ApplicationsRootItem();

  constructor(private readonly applicationsBranch: ApplicationsBranch) {}

  /** Whether `element` is one of this branch's own (non-root) items, for EntraTreeProvider's dispatch. */
  owns(element: vscode.TreeItem): boolean {
    return element === this.applicationsRoot;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return [this.applicationsRoot];
    }
    if (element === this.applicationsRoot) {
      return this.applicationsBranch.getChildren();
    }
    return [];
  }
}
