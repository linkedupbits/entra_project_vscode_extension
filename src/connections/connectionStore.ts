import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { Connection } from './types';
import { getArtifactsRootUri, getConnectionsFileUri } from '../workspacePaths';

/**
 * Reads/writes <artifactsRoot>/connections.yaml (UC012). This is the only class that touches
 * that file — UC012 deliberately makes the Add/Edit Connection form the sole supported way to
 * create or change a connection, so every write funnels through add()/update()/remove() here.
 * YAML (not JSON) so a hand-maintained project can annotate a connection with comments, the same
 * reason downloaded artifacts use YAML (see NonFunctionalRequirements.md).
 */
export class ConnectionStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  async list(): Promise<Connection[]> {
    const uri = getConnectionsFileUri();
    if (!uri) {
      return [];
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed: unknown = YAML.parse(Buffer.from(bytes).toString('utf8'));
      return Array.isArray(parsed) ? (parsed as Connection[]) : [];
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        return [];
      }
      throw err;
    }
  }

  async add(connection: Connection): Promise<void> {
    const all = await this.list();
    if (all.some((c) => c.name.toLowerCase() === connection.name.toLowerCase())) {
      throw new Error(`A connection named "${connection.name}" already exists.`);
    }
    all.push(connection);
    await this.save(all);
  }

  async update(originalName: string, connection: Connection): Promise<void> {
    const all = await this.list();
    const index = all.findIndex((c) => c.name === originalName);
    if (index === -1) {
      throw new Error(`No connection named "${originalName}" was found.`);
    }
    const nameClash = all.some(
      (c, i) => i !== index && c.name.toLowerCase() === connection.name.toLowerCase()
    );
    if (nameClash) {
      throw new Error(`A connection named "${connection.name}" already exists.`);
    }
    all[index] = connection;
    await this.save(all);
  }

  async remove(name: string): Promise<void> {
    const all = await this.list();
    await this.save(all.filter((c) => c.name !== name));
  }

  private async save(connections: Connection[]): Promise<void> {
    const root = getArtifactsRootUri();
    const uri = getConnectionsFileUri();
    if (!root || !uri) {
      throw new Error('Open a folder before managing Entra connections.');
    }
    await vscode.workspace.fs.createDirectory(root);
    const text = YAML.stringify(connections);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
