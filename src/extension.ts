import * as vscode from 'vscode';
import { ConnectionStore } from './connections/connectionStore';
import { ConnectionsBranch, ConnectionTreeItem } from './connections/connectionsBranch';
import { ProjectBranch } from './project/projectBranch';
import { ApplicationsBranch } from './applications/applicationsBranch';
import { ApplicationStore } from './applications/applicationStore';
import { ApplicationFormPanel } from './applications/applicationFormPanel';
import { EntraTreeProvider } from './tree/entraTreeProvider';
import { AuthService } from './auth/authService';
import { CredentialStore } from './auth/credentialStore';
import { ConnectionFormPanel } from './connections/connectionFormPanel';
import { resolveConnectionArg } from './connections/resolveConnectionArg';
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
    })
  );
}

export function deactivate(): void {
  // No teardown needed: context.subscriptions handles disposal.
}
