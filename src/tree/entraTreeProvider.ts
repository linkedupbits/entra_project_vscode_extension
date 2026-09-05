import * as vscode from 'vscode';
import { ConnectionsBranch, ConnectionsRootItem } from '../connections/connectionsBranch';
import { ProjectBranch, ProjectRootItem } from '../project/projectBranch';

/**
 * UC029 — the single tree control for the "Entra" view. getChildren() with no element returns
 * the two fixed roots (Connections, Project); everything below each root is delegated to that
 * root's own branch, so the two data sources (live Graph vs local filesystem) stay internally
 * separate even though they share one TreeDataProvider and render through the same shape.
 */
export class EntraTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly connectionsRoot = new ConnectionsRootItem();
  private readonly projectRoot = new ProjectRootItem();

  constructor(
    private readonly connectionsBranch: ConnectionsBranch,
    private readonly projectBranch: ProjectBranch
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return [this.connectionsRoot, this.projectRoot];
    }
    if (element === this.connectionsRoot) {
      return this.connectionsBranch.getChildren();
    }
    if (element === this.projectRoot) {
      return this.projectBranch.getChildren();
    }
    return [];
  }
}
