import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { getArtifactsRootFolder, getDefaultClientId, getAuthMode } from './config';

function mockConfig(values: Record<string, unknown>): void {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string, defaultValue: unknown) => (key in values ? values[key] : defaultValue),
  } as unknown as ReturnType<typeof vscode.workspace.getConfiguration>);
}

describe('config', () => {
  it('defaults artifactsRootFolder to "entra"', () => {
    mockConfig({});
    expect(getArtifactsRootFolder()).toBe('entra');
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('entra');
  });

  it('returns a configured artifactsRootFolder', () => {
    mockConfig({ artifactsRootFolder: 'my-entra-files' });
    expect(getArtifactsRootFolder()).toBe('my-entra-files');
  });

  it('defaults clientId to an empty string', () => {
    mockConfig({});
    expect(getDefaultClientId()).toBe('');
  });

  it('returns a configured clientId', () => {
    mockConfig({ clientId: 'abc-123' });
    expect(getDefaultClientId()).toBe('abc-123');
  });

  it('defaults authMode to "interactive"', () => {
    mockConfig({});
    expect(getAuthMode()).toBe('interactive');
  });

  it('returns a configured authMode', () => {
    mockConfig({ authMode: 'deviceCode' });
    expect(getAuthMode()).toBe('deviceCode');
  });
});
