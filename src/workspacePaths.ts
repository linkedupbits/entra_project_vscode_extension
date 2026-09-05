import * as vscode from 'vscode';
import { getArtifactsRootFolder } from './config';

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

export function getArtifactsRootUri(): vscode.Uri | undefined {
  const folder = getWorkspaceFolder();
  if (!folder) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, getArtifactsRootFolder());
}

export function getConnectionsFileUri(): vscode.Uri | undefined {
  const root = getArtifactsRootUri();
  if (!root) {
    return undefined;
  }
  return vscode.Uri.joinPath(root, 'connections.yaml');
}
