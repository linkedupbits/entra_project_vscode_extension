import * as vscode from 'vscode';

export type AuthMode = 'interactive' | 'deviceCode';

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('entra');
}

export function getArtifactsRootFolder(): string {
  return config().get<string>('artifactsRootFolder', 'entra');
}

export function getDefaultClientId(): string {
  return config().get<string>('clientId', '');
}

export function getAuthMode(): AuthMode {
  return config().get<AuthMode>('authMode', 'interactive');
}
