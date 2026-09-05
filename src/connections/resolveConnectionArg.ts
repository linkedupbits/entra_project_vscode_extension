import * as vscode from 'vscode';
import { Connection } from './types';
import { ConnectionStore } from './connectionStore';

/**
 * Resolves which connection a command (connect/disconnect/edit) should act on: the tree item it
 * was invoked from, if any, otherwise a quick-pick fallback over the store — so these commands
 * work from the command palette too (UC010's "or runs the entra.connect command"), not only from
 * a context menu with a pre-selected item.
 */
export async function resolveConnectionArg(
  store: ConnectionStore,
  item: { connection: Connection } | undefined,
  placeHolder: string,
  filter?: (c: Connection) => boolean
): Promise<Connection | undefined> {
  if (item?.connection) {
    return item.connection;
  }
  const all = await store.list();
  const candidates = filter ? all.filter(filter) : all;
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('No matching connections found.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((c) => ({ label: c.name, description: c.tenantId, connection: c })),
    { placeHolder }
  );
  return pick?.connection;
}
