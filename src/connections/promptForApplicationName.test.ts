import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { promptForApplicationName } from './promptForApplicationName';

describe('promptForApplicationName', () => {
  it('returns the trimmed value the user entered', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('  sample-web-app  ');

    expect(await promptForApplicationName()).toBe('sample-web-app');
  });

  it('returns undefined when the user cancels the prompt', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);

    expect(await promptForApplicationName()).toBeUndefined();
  });

  it('returns undefined when the user submits a blank value', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('   ');

    expect(await promptForApplicationName()).toBeUndefined();
  });

  it('validates that a blank input is rejected', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('sample-web-app');

    await promptForApplicationName();

    const options = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    expect(options?.validateInput?.('   ')).toBe('Enter an application name.');
    expect(options?.validateInput?.('sample-web-app')).toBeUndefined();
  });
});
