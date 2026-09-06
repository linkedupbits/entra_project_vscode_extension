import * as vscode from 'vscode';
import { Connection } from './types';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';
import { listApplications, listServicePrincipals, GraphApplication } from '../graph/graphClient';
import { environmentTagValue } from './tenantApplicationIdentity';

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

/**
 * One node per Entra application (app registration) returned by Microsoft Graph for a
 * connection's tenant (UC030). Clicking it runs `entra.previewArtifact` (UC034 — the currently
 * implemented instance of UC032's generic artifact preview, scoped to this artifact type).
 */
export class TenantApplicationItem extends vscode.TreeItem {
  constructor(
    public readonly connection: Connection,
    public readonly application: GraphApplication
  ) {
    super(application.displayName || application.appId, vscode.TreeItemCollapsibleState.None);
    this.description = application.appId;
    this.contextValue = 'tenantApplication';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
    this.tooltip = new vscode.MarkdownString(
      `**${application.displayName || '(no display name)'}**\n\n` +
        `Application (client) ID: ${application.appId}\n\nObject ID: ${application.id}`
    );
    this.command = {
      command: 'entra.previewArtifact',
      title: 'Preview',
      arguments: [{ connection, application }],
    };
  }
}

/**
 * UC030 — a grouping node under the Applications folder collecting every tenant application whose
 * Service Principal carries the same `Environment:<name>` tag (UC042's Generated tags convention).
 * Applications whose Service Principal has no such tag (or that have no Service Principal at all)
 * are listed directly under the Applications folder rather than under a group.
 */
export class TenantApplicationEnvironmentGroupItem extends vscode.TreeItem {
  constructor(
    public readonly connection: Connection,
    public readonly environment: string,
    public readonly applications: GraphApplication[]
  ) {
    super(`Environment: ${environment}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'tenantApplicationEnvironmentGroup';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    this.description = `${applications.length} application${applications.length === 1 ? '' : 's'}`;
    this.tooltip = new vscode.MarkdownString(
      `Applications tagged **Environment: ${environment}** in ${connection.name}`
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
    return (
      element instanceof ConnectionTreeItem ||
      element instanceof TenantApplicationsRootItem ||
      element instanceof TenantApplicationEnvironmentGroupItem
    );
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
    if (element instanceof TenantApplicationEnvironmentGroupItem) {
      return element.applications.map((application) => new TenantApplicationItem(element.connection, application));
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
    let accessToken: string;
    let applications: GraphApplication[];
    try {
      accessToken = await this.authService.getGraphAccessToken(connection);
      applications = await listApplications(accessToken, connection.cloud);
    } catch (err) {
      return [new TenantApplicationsErrorItem(err instanceof Error ? err.message : String(err))];
    }
    if (applications.length === 0) {
      return [new TenantApplicationsEmptyPlaceholderItem()];
    }

    return groupApplicationsByEnvironment(
      connection,
      applications,
      await this.servicePrincipalTagsByAppId(connection, accessToken)
    );
  }

  /**
   * Maps each Service Principal's `appId` to its `tags`, for environment grouping. If listing
   * Service Principals fails (e.g. the connection lacks ServicePrincipal.Read.All), returns an
   * empty map so the Applications node falls back to a flat, ungrouped list rather than erroring
   * out entirely — the applications themselves already loaded.
   */
  private async servicePrincipalTagsByAppId(
    connection: Connection,
    accessToken: string
  ): Promise<Map<string, string[]>> {
    try {
      const servicePrincipals = await listServicePrincipals(accessToken, connection.cloud);
      return new Map(servicePrincipals.map((sp) => [sp.appId, sp.tags]));
    } catch {
      return new Map();
    }
  }
}

const byDisplayName = (a: GraphApplication, b: GraphApplication): number =>
  (a.displayName || a.appId).localeCompare(b.displayName || b.appId);

/**
 * UC030 — splits a connection's applications into one `TenantApplicationEnvironmentGroupItem` per
 * distinct `Environment:<name>` tag found on the matching Service Principal, sorted by environment
 * name, followed by a flat list of `TenantApplicationItem`s for every application with no such tag.
 */
function groupApplicationsByEnvironment(
  connection: Connection,
  applications: GraphApplication[],
  tagsByAppId: Map<string, string[]>
): vscode.TreeItem[] {
  const byEnvironment = new Map<string, GraphApplication[]>();
  const ungrouped: GraphApplication[] = [];

  for (const application of applications) {
    const environment = environmentTagValue(tagsByAppId.get(application.appId) ?? []);
    if (environment === undefined) {
      ungrouped.push(application);
      continue;
    }
    const group = byEnvironment.get(environment) ?? [];
    group.push(application);
    byEnvironment.set(environment, group);
  }

  const groupItems = [...byEnvironment.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([environment, apps]) =>
        new TenantApplicationEnvironmentGroupItem(connection, environment, apps.sort(byDisplayName))
    );

  const ungroupedItems = ungrouped
    .sort(byDisplayName)
    .map((application) => new TenantApplicationItem(connection, application));

  return [...groupItems, ...ungroupedItems];
}
