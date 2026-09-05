import * as vscode from 'vscode';
import { AuthService } from './auth/authService';
import { ConnectionStore } from './connections/connectionStore';

export interface StatusBarContent {
  text: string;
  tooltip: string;
}

/** Pure formatting logic, isolated from the vscode.StatusBarItem it's applied to. */
export function formatStatus(connectedNames: readonly string[]): StatusBarContent | undefined {
  if (connectedNames.length === 0) {
    return undefined;
  }
  const joined = connectedNames.join(', ');
  return { text: `$(plug) ${joined}`, tooltip: `Connected to: ${joined}` };
}

/** Shows which connections are currently authenticated (UC010/UC011). */
export function registerStatusBar(
  context: vscode.ExtensionContext,
  authService: AuthService,
  store: ConnectionStore
): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.name = 'Entra Connections';

  const update = async (): Promise<void> => {
    const connections = await store.list();
    const connectedNames = connections.filter((c) => authService.isConnected(c.name)).map((c) => c.name);
    const content = formatStatus(connectedNames);
    if (!content) {
      item.hide();
      return;
    }
    item.text = content.text;
    item.tooltip = content.tooltip;
    item.show();
  };

  context.subscriptions.push(
    item,
    authService.onDidChangeConnectionState(() => void update()),
    store.onDidChange(() => void update())
  );
  void update();
}
