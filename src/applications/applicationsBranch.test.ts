import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { TreeItemCollapsibleState } from '../test/vscodeMock';
import { ApplicationsBranch, ApplicationsRootItem, ApplicationItem } from './applicationsBranch';

vi.mock('../workspacePaths', () => ({
  getApplicationsRootUri: vi.fn(),
}));

import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/applications', toString: () => '/repo/entra/applications' };

function givenNoWorkspace(): void {
  vi.mocked(getApplicationsRootUri).mockReturnValue(undefined);
}

function givenApplicationsRoot(): void {
  vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
}

describe('ApplicationsRootItem', () => {
  it('is a collapsed root labelled Applications', () => {
    const item = new ApplicationsRootItem();
    expect(item.label).toBe('Applications');
    expect(item.contextValue).toBe('applicationsRoot');
  });
});

describe('ApplicationsBranch.getChildren', () => {
  it('shows a placeholder when no workspace is open', async () => {
    givenNoWorkspace();
    const children = await new ApplicationsBranch().getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('applicationsEmptyPlaceholder');
  });

  it('shows a placeholder when the applications folder does not exist yet', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValueOnce(
      new (vscode as unknown as { FileSystemError: new (code: string) => Error }).FileSystemError('FileNotFound')
    );
    const children = await new ApplicationsBranch().getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('applicationsEmptyPlaceholder');
  });

  it('rethrows other filesystem errors', async () => {
    givenApplicationsRoot();
    const boom = new Error('disk on fire');
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValueOnce(boom);
    await expect(new ApplicationsBranch().getChildren()).rejects.toBe(boom);
  });

  it('shows a placeholder when the folder exists but is empty', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([]);
    const children = await new ApplicationsBranch().getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('applicationsEmptyPlaceholder');
  });

  it('lists subfolders as applications, sorted, ignoring stray files', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([
      ['sample-web-app', vscode.FileType.Directory],
      ['README.md', vscode.FileType.File],
      ['sample-api', vscode.FileType.Directory],
    ] as never);

    const children = (await new ApplicationsBranch().getChildren()) as ApplicationItem[];

    expect(children.map((c) => c.label)).toEqual(['sample-api', 'sample-web-app']);
    expect(children[0].contextValue).toBe('application');
    expect(children[0].folderUri.fsPath).toBe('/repo/entra/applications/sample-api');
  });

  it('opens the structured application view when clicked (UC042), not a raw file', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([
      ['sample-web-app', vscode.FileType.Directory],
    ] as never);

    const [app] = (await new ApplicationsBranch().getChildren()) as ApplicationItem[];

    const command = app.command as { command: string; title: string; arguments: [{ folderUri: unknown; name: string }] };
    expect(command.command).toBe('entra.viewApplication');
    expect(command.arguments[0].name).toBe('sample-web-app');
    expect((command.arguments[0].folderUri as { fsPath: string }).fsPath).toBe(
      '/repo/entra/applications/sample-web-app'
    );
  });

  it('is a leaf node — it no longer expands to show its backing files', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([
      ['sample-web-app', vscode.FileType.Directory],
    ] as never);

    const [app] = (await new ApplicationsBranch().getChildren()) as ApplicationItem[];

    expect(app.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });
});

describe('ApplicationsBranch.listApplicationNames', () => {
  it('returns an empty array when no workspace is open', async () => {
    givenNoWorkspace();
    expect(await new ApplicationsBranch().listApplicationNames()).toEqual([]);
  });

  it('returns sorted subfolder names, ignoring stray files', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValueOnce([
      ['sample-web-app', vscode.FileType.Directory],
      ['README.md', vscode.FileType.File],
      ['sample-api', vscode.FileType.Directory],
    ] as never);

    expect(await new ApplicationsBranch().listApplicationNames()).toEqual(['sample-api', 'sample-web-app']);
  });

  it('returns an empty array when the applications folder does not exist yet', async () => {
    givenApplicationsRoot();
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValueOnce(
      new (vscode as unknown as { FileSystemError: new (code: string) => Error }).FileSystemError('FileNotFound')
    );
    expect(await new ApplicationsBranch().listApplicationNames()).toEqual([]);
  });
});

