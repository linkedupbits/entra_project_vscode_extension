import * as vscode from 'vscode';
import { Connection } from './types';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';

export class ConnectionsRootItem extends vscode.TreeItem {
  constructor() {
    super('Connections', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'connectionsRoot';
    this.iconPath = new vscode.ThemeIcon('link');
  }
}

/**
 * One node per saved connection (UC029). Category folders / artifact-detail children are not
 * implemented yet (UC030, a later phase) — connections are leaf nodes for now, and
 * connect/disconnect/edit are driven by commands rather than by expanding the node.
 */
export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly connection: Connection,
    connected: boolean
  ) {
    super(connection.name, vscode.TreeItemCollapsibleState.None);
    this.description = connection.tenantId;
    this.contextValue = connected ? 'connection-connected' : 'connection-disconnected';
    this.iconPath = connected
      ? new vscode.ThemeIcon('plug', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('circle-large-outline');
    this.tooltip = new vscode.MarkdownString(
      `**${connection.name}**\n\nTenant: ${connection.tenantId}\n\nCloud: ${connection.cloud}\n\n${
        connected ? 'Connected' : 'Not connected'
      }`
    );
    this.command = {
      command: 'entra.editConnection',
      title: 'Edit Connection',
      arguments: [{ connection }],
    };
  }
}

class ConnectionsEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No connections yet — click to add one', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'connectionsEmptyPlaceholder';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = { command: 'entra.addConnection', title: 'Add Connection' };
  }
}

/** UC029 — supplies the children of the Connections root. */
export class ConnectionsBranch {
  constructor(
    private readonly store: ConnectionStore,
    private readonly authService: AuthService
  ) {}

  async getChildren(): Promise<vscode.TreeItem[]> {
    const connections = await this.store.list();
    if (connections.length === 0) {
      return [new ConnectionsEmptyPlaceholderItem()];
    }
    return connections
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => new ConnectionTreeItem(c, this.authService.isConnected(c.name)));
  }
}
