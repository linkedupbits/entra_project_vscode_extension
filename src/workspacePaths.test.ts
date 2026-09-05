import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('./config', () => ({
  getArtifactsRootFolder: vi.fn(() => 'entra'),
}));

import { getWorkspaceFolder, getArtifactsRootUri, getConnectionsFileUri, getApplicationsRootUri } from './workspacePaths';

function setWorkspaceFolders(folders: unknown): void {
  (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = folders;
}

describe('workspacePaths', () => {
  it('returns undefined for everything when no workspace folder is open', () => {
    setWorkspaceFolders(undefined);
    expect(getWorkspaceFolder()).toBeUndefined();
    expect(getArtifactsRootUri()).toBeUndefined();
    expect(getConnectionsFileUri()).toBeUndefined();
    expect(getApplicationsRootUri()).toBeUndefined();
  });

  it('resolves the artifacts root under the first workspace folder', () => {
    setWorkspaceFolders([{ uri: { fsPath: '/repo' } }]);

    expect(getWorkspaceFolder()).toEqual({ uri: { fsPath: '/repo' } });
    expect(getArtifactsRootUri()?.toString()).toBe('/repo/entra');
    expect(getConnectionsFileUri()?.toString()).toBe('/repo/entra/connections.yaml');
    expect(getApplicationsRootUri()?.toString()).toBe('/repo/entra/applications');
  });
});
