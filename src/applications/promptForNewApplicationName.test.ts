import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { promptForNewApplicationName } from './promptForNewApplicationName';

describe('promptForNewApplicationName', () => {
  it('returns the trimmed name the user entered', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('  new-app  ');
    expect(await promptForNewApplicationName([])).toBe('new-app');
  });

  it('returns undefined when the user cancels or submits blank', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    expect(await promptForNewApplicationName([])).toBeUndefined();

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('   ');
    expect(await promptForNewApplicationName([])).toBeUndefined();
  });

  it('validates blank, path-separator, and duplicate names', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('new-app');

    await promptForNewApplicationName(['existing']);

    const validate = vi.mocked(vscode.window.showInputBox).mock.calls[0][0]?.validateInput;
    expect(validate?.('   ')).toBe('Enter an application name.');
    expect(validate?.('a/b')).toContain('cannot be');
    expect(validate?.('existing')).toBe('An application named "existing" already exists.');
    expect(validate?.('new-app')).toBeUndefined();
  });
});
