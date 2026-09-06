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
import { ApplicationEditorProvider } from './applications/applicationEditorProvider';
import { toApplicationEditorUri } from './applications/applicationEditorUri';
import { ApplicationDocumentProvider } from './applications/applicationDocumentProvider';
import { APPLICATION_DOCUMENT_SCHEME, toApplicationDocumentUri } from './applications/applicationDocumentUri';
import { createApplication } from './applications/createApplication';
import { promptForNewApplicationName } from './applications/promptForNewApplicationName';
import { confirmDeleteApplication, deleteApplication } from './applications/deleteApplication';
import { resolveApplicationArg } from './applications/resolveApplicationArg';
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
    vscode.workspace.registerFileSystemProvider(APPLICATION_DOCUMENT_SCHEME, new ApplicationDocumentProvider(applicationStore), {
      isCaseSensitive: true,
    }),
    // UC042 — a Custom Editor (not a plain WebviewPanel) so its tab shows VS Code's native
    // unsaved-changes indicator; `retainContextWhenHidden` keeps the webview's live DOM (and thus
    // any unsaved in-progress edits) alive while the tab is hidden, rather than re-rendering from
    // last-saved disk content when the user switches back to it. The `entra.applicationEditor`
    // viewType must also be declared under package.json's `contributes.customEditors` — VS Code
    // requires that to accept this registration. Its `selector` is a broad `**/*` with
    // `priority: "option"` rather than something matching our virtual URIs specifically: this
    // editor is only ever opened explicitly (`vscode.openWith` from `entra.viewApplication`), never
    // by VS Code auto-selecting a default editor for a real file, so "option" (never auto-picked)
    // is what keeps the broad pattern from hijacking unrelated files.
    vscode.window.registerCustomEditorProvider(
      ApplicationEditorProvider.viewType,
      new ApplicationEditorProvider(applicationStore, applicationsBranch),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
    )
  );

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

    vscode.commands.registerCommand('entra.viewApplication', (item: { folderUri: vscode.Uri }) => {
      void vscode.commands.executeCommand(
        'vscode.openWith',
        toApplicationEditorUri(item.folderUri),
        ApplicationEditorProvider.viewType
      );
    }),

    // UC043 — create a new, empty application definition folder from the Applications node, then
    // open it straight into UC042's structured editor.
    vscode.commands.registerCommand('entra.newApplication', async () => {
      const existingNames = await applicationsBranch.listApplicationNames();
      const name = await promptForNewApplicationName(existingNames);
      if (!name) {
        return;
      }
      try {
        const result = await createApplication(applicationStore, existingNames, name);
        if (result.kind === 'ok') {
          treeProvider.refresh();
          void vscode.commands.executeCommand('entra.viewApplication', {
            folderUri: result.folderUri,
            name: result.name,
          });
        } else if (result.kind === 'noWorkspace') {
          void vscode.window.showErrorMessage('Open a workspace folder before creating an application.');
        } else if (result.kind === 'alreadyExists') {
          void vscode.window.showErrorMessage(`An application named "${name}" already exists.`);
        } else {
          void vscode.window.showErrorMessage(`"${name}" is not a valid application name.`);
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Could not create "${name}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    // UC043 — delete a project application's folder (to the OS trash), after a modal confirmation.
    // Any open editor tab for that application is closed first, so a stale tab can't recreate the
    // folder by saving.
    vscode.commands.registerCommand(
      'entra.deleteApplication',
      async (item?: { folderUri?: vscode.Uri; name?: string }) => {
        const target = await resolveApplicationArg(applicationsBranch, item, 'Select an application to delete');
        if (!target || !(await confirmDeleteApplication(target.name))) {
          return;
        }
        const openUris = new Set([
          toApplicationEditorUri(target.folderUri).toString(),
          toApplicationDocumentUri(target.folderUri).toString(),
        ]);
        for (const group of vscode.window.tabGroups?.all ?? []) {
          for (const tab of group.tabs) {
            const tabUri = (tab.input as { uri?: vscode.Uri } | undefined)?.uri;
            if (tabUri && openUris.has(tabUri.toString())) {
              void vscode.window.tabGroups.close(tab);
            }
          }
        }
        try {
          await deleteApplication(target.folderUri);
          treeProvider.refresh();
          void vscode.window.showInformationMessage(`Deleted "${target.name}".`);
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Could not delete "${target.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    ),

    // A second, text-based editing surface for a project application, alongside UC042's structured
    // webview — not a replacement for it. Opens the same four files, combined, as one normal,
    // savable editor tab backed by ApplicationDocumentProvider.
    vscode.commands.registerCommand('entra.openApplicationDocument', async (item: { folderUri: vscode.Uri }) => {
      const documentUri = toApplicationDocumentUri(item.folderUri);
      const document = await vscode.workspace.openTextDocument(documentUri);
      await vscode.window.showTextDocument(document);
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
  // captures the previewed application into `<artifactsRoot>/Applications/<appName>/`, identified
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
        void vscode.window.showInformationMessage(`Downloaded "${label}" to Applications/${identity!.appName}.`);
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
