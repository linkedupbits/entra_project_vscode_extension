import * as vscode from 'vscode';
import { ConnectionStore } from './connections/connectionStore';
import { ConnectionsBranch, ConnectionTreeItem } from './connections/connectionsBranch';
import { Connection } from './connections/types';
import { loadApplicationPreview, ApplicationPreviewData } from './connections/tenantApplicationPreview';
import { buildApplicationPreviewHtml } from './connections/applicationPreviewHtml';
import { parseTenantApplicationIdentity, ApplicationDownloadTarget } from './connections/tenantApplicationIdentity';
import { promptForApplicationName } from './connections/promptForApplicationName';
import { downloadApplicationToProject } from './connections/downloadApplicationToProject';
import { ProjectBranch } from './project/projectBranch';
import { ApplicationsBranch } from './applications/applicationsBranch';
import { ApplicationStore } from './applications/applicationStore';
import { ApplicationFormPanel } from './applications/applicationFormPanel';
import { EntraTreeProvider } from './tree/entraTreeProvider';
import { AuthService } from './auth/authService';
import { CredentialStore } from './auth/credentialStore';
import { ConnectionFormPanel } from './connections/connectionFormPanel';
import { resolveConnectionArg } from './connections/resolveConnectionArg';
import { GraphApplication } from './graph/graphClient';
import { ArtifactViewerPanel } from './webview/artifactViewerPanel';
import { registerStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  const connectionStore = new ConnectionStore();
  const credentialStore = new CredentialStore(context.secrets);
  const authService = new AuthService(context.secrets, credentialStore);
  const connectionsBranch = new ConnectionsBranch(connectionStore, authService);
  const applicationStore = new ApplicationStore();
  const applicationsBranch = new ApplicationsBranch();
  const projectBranch = new ProjectBranch(applicationsBranch);
  const treeProvider = new EntraTreeProvider(connectionsBranch, projectBranch);

  const treeView = vscode.window.createTreeView('entraTree', { treeDataProvider: treeProvider });

  context.subscriptions.push(
    connectionStore,
    authService,
    treeView,
    connectionStore.onDidChange(() => treeProvider.refresh()),
    authService.onDidChangeConnectionState(() => treeProvider.refresh())
  );

  registerStatusBar(context, authService, connectionStore);

  context.subscriptions.push(
    vscode.commands.registerCommand('entra.addConnection', () => {
      ConnectionFormPanel.show(connectionStore, authService, credentialStore, undefined);
    }),

    vscode.commands.registerCommand('entra.editConnection', async (item?: ConnectionTreeItem) => {
      const connection = await resolveConnectionArg(connectionStore, item, 'Select a connection to edit');
      if (connection) {
        ConnectionFormPanel.show(connectionStore, authService, credentialStore, connection);
      }
    }),

    vscode.commands.registerCommand('entra.connect', async (item?: ConnectionTreeItem) => {
      const connection = await resolveConnectionArg(
        connectionStore,
        item,
        'Select a connection to connect',
        (c) => !authService.isConnected(c.name)
      );
      if (!connection) {
        return;
      }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Connecting to "${connection.name}"…` },
          () => authService.connect(connection)
        );
        void vscode.window.showInformationMessage(`Connected to "${connection.name}".`);
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Could not connect to "${connection.name}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand('entra.disconnect', async (item?: ConnectionTreeItem) => {
      const connection = await resolveConnectionArg(
        connectionStore,
        item,
        'Select a connection to disconnect',
        (c) => authService.isConnected(c.name)
      );
      if (!connection) {
        return;
      }
      await authService.disconnect(connection.name);
      void vscode.window.showInformationMessage(`Disconnected from "${connection.name}".`);
    }),

    vscode.commands.registerCommand('entra.refreshConnections', () => treeProvider.refresh()),

    vscode.commands.registerCommand('entra.viewApplication', (item: { folderUri: vscode.Uri; name: string }) => {
      ApplicationFormPanel.show(applicationStore, applicationsBranch, item.folderUri, item.name);
    }),

    // UC034 — the currently implemented instance of UC032's generic artifact preview, scoped to
    // an Applications-category artifact reached via UC030. Structured, read-only, mirroring
    // UC042's local editor layout (Application/Federated Credentials/Service Principal). Always
    // offers a Download button (UC035); if no AppName: tag can be parsed, UC035 A4's wizard asks
    // for an application name instead of refusing to download.
    vscode.commands.registerCommand(
      'entra.previewArtifact',
      async (item: { connection: Connection; application: GraphApplication }) => {
        const label = item.application.displayName || item.application.appId;
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading "${label}"…` },
            async () => {
              const data = await loadApplicationPreview(authService, item.connection, item.application);
              ArtifactViewerPanel.show(
                `${item.connection.name}::${item.application.id}`,
                label,
                `Connection: ${item.connection.name}`,
                buildApplicationPreviewHtml(data),
                () => downloadApplicationPreview(label, item.connection, data)
              );
            }
          );
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Could not load "${label}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    )
  );

  // UC035 — the currently implemented instance of UC031's generic download, scoped to Applications:
  // captures the previewed application into `<artifactsRoot>/applications/<appName>/`, identified
  // by the AppName: tag rather than a flat downloaded-artifact snapshot (see UC040's open question
  // this resolves for Applications specifically). Falls back to UC035 A4's wizard when no tag is
  // present, rather than refusing to download.
  async function downloadApplicationPreview(
    label: string,
    connection: Connection,
    data: ApplicationPreviewData
  ): Promise<void> {
    const tags = data.servicePrincipal.kind === 'ok' ? data.servicePrincipal.value.tags : [];
    let identity: ApplicationDownloadTarget | undefined = parseTenantApplicationIdentity(tags);
    if (!identity) {
      const appName = await promptForApplicationName();
      if (!appName) {
        return;
      }
      identity = { appName };
    }

    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Downloading "${label}"…` },
        () => downloadApplicationToProject(applicationStore, identity!, data, connection)
      );
      if (result.kind === 'ok') {
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Downloaded "${label}" to applications/${identity!.appName}.`);
      } else if (result.kind === 'noWorkspace') {
        void vscode.window.showErrorMessage('Open a workspace folder before downloading an application.');
      } else {
        void vscode.window.showErrorMessage(
          `Could not download "${label}": part of its preview failed to load. Reopen the preview and try again.`
        );
      }
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Could not download "${label}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export function deactivate(): void {
  // No teardown needed: context.subscriptions handles disposal.
}
