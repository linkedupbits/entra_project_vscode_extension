import * as vscode from 'vscode';
import { ApplicationsBranch, ApplicationsRootItem, ApplicationItem } from '../applications/applicationsBranch';

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
 * download feature.
 */
export class ProjectBranch {
  private readonly applicationsRoot = new ApplicationsRootItem();

  constructor(private readonly applicationsBranch: ApplicationsBranch) {}

  /** Whether `element` is one of this branch's own (non-root) items, for EntraTreeProvider's dispatch. */
  owns(element: vscode.TreeItem): boolean {
    return element === this.applicationsRoot || element instanceof ApplicationItem;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return [this.applicationsRoot];
    }
    if (element === this.applicationsRoot) {
      return this.applicationsBranch.getChildren();
    }
    if (element instanceof ApplicationItem) {
      return this.applicationsBranch.getFiles(element);
    }
    return [];
  }
}
