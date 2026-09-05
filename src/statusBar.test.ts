import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { formatStatus, registerStatusBar } from './statusBar';
import { AuthService } from './auth/authService';
import { ConnectionStore } from './connections/connectionStore';

describe('formatStatus', () => {
  it('is undefined when nothing is connected', () => {
    expect(formatStatus([])).toBeUndefined();
  });

  it('formats a single connection', () => {
    expect(formatStatus(['Contoso Dev'])).toEqual({
      text: '$(plug) Contoso Dev',
      tooltip: 'Connected to: Contoso Dev',
    });
  });

  it('joins multiple connections', () => {
    expect(formatStatus(['A', 'B'])).toEqual({
      text: '$(plug) A, B',
      tooltip: 'Connected to: A, B',
    });
  });
});

describe('registerStatusBar', () => {
  function fakeStatusBarItem() {
    return { name: '', text: '', tooltip: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
  }

  function fakeContext(): vscode.ExtensionContext {
    return { subscriptions: [] } as unknown as vscode.ExtensionContext;
  }

  it('hides the item when nothing is connected', async () => {
    const item = fakeStatusBarItem();
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValueOnce(item as never);
    const store = { list: vi.fn(async () => []), onDidChange: vi.fn(() => ({ dispose: vi.fn() })) } as unknown as ConnectionStore;
    const auth = {
      isConnected: vi.fn(() => false),
      onDidChangeConnectionState: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as AuthService;

    registerStatusBar(fakeContext(), auth, store);

    await vi.waitFor(() => expect(item.hide).toHaveBeenCalled());
    expect(item.show).not.toHaveBeenCalled();
  });

  it('shows the connected names when at least one connection is authenticated', async () => {
    const item = fakeStatusBarItem();
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValueOnce(item as never);
    const store = {
      list: vi.fn(async () => [{ name: 'Contoso Dev', tenantId: 't', cloud: 'public' as const }]),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as ConnectionStore;
    const auth = {
      isConnected: vi.fn(() => true),
      onDidChangeConnectionState: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as AuthService;

    registerStatusBar(fakeContext(), auth, store);

    await vi.waitFor(() => expect(item.show).toHaveBeenCalled());
    expect(item.text).toBe('$(plug) Contoso Dev');
    expect(item.tooltip).toBe('Connected to: Contoso Dev');
  });

  it('re-renders when the auth service reports a connection-state change', async () => {
    const item = fakeStatusBarItem();
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValueOnce(item as never);
    let connected = false;
    let changeListener: (() => void) | undefined;
    const store = {
      list: vi.fn(async () => [{ name: 'Contoso Dev', tenantId: 't', cloud: 'public' as const }]),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as ConnectionStore;
    const auth = {
      isConnected: vi.fn(() => connected),
      onDidChangeConnectionState: vi.fn((listener: () => void) => {
        changeListener = listener;
        return { dispose: vi.fn() };
      }),
    } as unknown as AuthService;

    registerStatusBar(fakeContext(), auth, store);
    await vi.waitFor(() => expect(item.hide).toHaveBeenCalledTimes(1));

    connected = true;
    changeListener?.();

    await vi.waitFor(() => expect(item.show).toHaveBeenCalledTimes(1));
    expect(item.text).toBe('$(plug) Contoso Dev');
  });
});
