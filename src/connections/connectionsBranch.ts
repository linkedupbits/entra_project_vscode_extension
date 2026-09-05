import * as vscode from 'vscode';
import { Connection } from './types';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';
import { listApplications, GraphApplication } from '../graph/graphClient';

export class ConnectionsRootItem extends vscode.TreeItem {
  constructor() {
    super('Connections', vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'connectionsRoot';
    this.iconPath = new vscode.ThemeIcon('link');
  }
}

/**
 * One node per saved connection (UC029). A connected connection is expandable to show its
 * Applications folder (UC030); a disconnected one is a leaf, since there's nothing to browse
 * until the user runs `entra.connect` — expanding a disconnected connection to trigger
 * authentication automatically (UC029 A1) isn't implemented yet. Either way, clicking the node
 * itself (as opposed to expanding it) still opens Edit Connection, unrelated to expand/collapse.
 */
export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly connection: Connection,
    connected: boolean
  ) {
    super(connection.name, connected ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
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

/**
 * UC030 — the "Applications" category folder shown under a connected connection. Of UC030's full
 * fixed category set (App Registrations, Service Principals, Groups, Directory Roles, External ID
 * User Flows, External ID Custom Authentication Extensions), only this one is implemented so far.
 */
export class TenantApplicationsRootItem extends vscode.TreeItem {
  constructor(public readonly connection: Connection) {
    super('Applications', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'tenantApplicationsRoot';
    this.iconPath = new vscode.ThemeIcon('package');
  }
}

/** One node per Entra application (app registration) returned by Microsoft Graph for a connection's tenant (UC030). */
export class TenantApplicationItem extends vscode.TreeItem {
  constructor(application: GraphApplication) {
    super(application.displayName || application.appId, vscode.TreeItemCollapsibleState.None);
    this.description = application.appId;
    this.contextValue = 'tenantApplication';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.tooltip = new vscode.MarkdownString(
      `**${application.displayName || '(no display name)'}**\n\n` +
        `Application (client) ID: ${application.appId}\n\nObject ID: ${application.id}`
    );
  }
}

class TenantApplicationsEmptyPlaceholderItem extends vscode.TreeItem {
  constructor() {
    super('No applications found', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tenantApplicationsEmptyPlaceholder';
  }
}

/** Shown in place of the application list if the Graph call fails, instead of leaving the node stuck on a spinner or throwing out of getChildren(). */
class TenantApplicationsErrorItem extends vscode.TreeItem {
  constructor(message: string) {
    super('Could not load applications', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tenantApplicationsError';
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    this.description = message;
    this.tooltip = message;
  }
}

/** UC029/UC030 — supplies the children of the Connections root, and of each connected connection's Applications folder. */
export class ConnectionsBranch {
  constructor(
    private readonly store: ConnectionStore,
    private readonly authService: AuthService
  ) {}

  /** Whether `element` is one of this branch's own (non-root) items, for EntraTreeProvider's dispatch. */
  owns(element: vscode.TreeItem): boolean {
    return element instanceof ConnectionTreeItem || element instanceof TenantApplicationsRootItem;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      return this.getConnections();
    }
    if (element instanceof ConnectionTreeItem) {
      return this.authService.isConnected(element.connection.name)
        ? [new TenantApplicationsRootItem(element.connection)]
        : [];
    }
    if (element instanceof TenantApplicationsRootItem) {
      return this.getApplications(element.connection);
    }
    return [];
  }

  private async getConnections(): Promise<vscode.TreeItem[]> {
    const connections = await this.store.list();
    if (connections.length === 0) {
      return [new ConnectionsEmptyPlaceholderItem()];
    }
    return connections
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => new ConnectionTreeItem(c, this.authService.isConnected(c.name)));
  }

  private async getApplications(connection: Connection): Promise<vscode.TreeItem[]> {
    try {
      const accessToken = await this.authService.getGraphAccessToken(connection);
      const applications = await listApplications(accessToken, connection.cloud);
      if (applications.length === 0) {
        return [new TenantApplicationsEmptyPlaceholderItem()];
      }
      return applications
        .slice()
        .sort((a, b) => (a.displayName || a.appId).localeCompare(b.displayName || b.appId))
        .map((application) => new TenantApplicationItem(application));
    } catch (err) {
      return [new TenantApplicationsErrorItem(err instanceof Error ? err.message : String(err))];
    }
  }
}
