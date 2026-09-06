import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { confirmDeleteApplication, deleteApplication } from './deleteApplication';

const folderUri = { fsPath: '/repo/entra/Applications/sample-web-app' } as never;

describe('confirmDeleteApplication', () => {
  it('shows a modal warning and returns true only when the user picks Delete', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Delete' as never);
    expect(await confirmDeleteApplication('sample-web-app')).toBe(true);

    const [message, options, action] = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    expect(message).toContain('sample-web-app');
    expect(options).toEqual({ modal: true });
    expect(action).toBe('Delete');
  });

  it('returns false when the user dismisses the dialog', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as never);
    expect(await confirmDeleteApplication('sample-web-app')).toBe(false);
  });
});

describe('deleteApplication', () => {
  it('deletes the folder recursively, to the trash', async () => {
    vi.mocked(vscode.workspace.fs.delete).mockResolvedValueOnce(undefined as never);

    await deleteApplication(folderUri);

    expect(vscode.workspace.fs.delete).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(folderUri, { recursive: true, useTrash: true });
  });

  it('falls back to a permanent delete when the filesystem provider does not support the trash', async () => {
    vi.mocked(vscode.workspace.fs.delete)
      .mockRejectedValueOnce(new Error('cannot delete via trash because provider does not support it'))
      .mockResolvedValueOnce(undefined as never);

    await deleteApplication(folderUri);

    expect(vscode.workspace.fs.delete).toHaveBeenNthCalledWith(1, folderUri, { recursive: true, useTrash: true });
    expect(vscode.workspace.fs.delete).toHaveBeenNthCalledWith(2, folderUri, { recursive: true, useTrash: false });
  });

  it('propagates the permanent-delete error when both attempts fail', async () => {
    vi.mocked(vscode.workspace.fs.delete)
      .mockRejectedValueOnce(new Error('no trash'))
      .mockRejectedValueOnce(new Error('permission denied'));

    await expect(deleteApplication(folderUri)).rejects.toThrow('permission denied');
  });
});
