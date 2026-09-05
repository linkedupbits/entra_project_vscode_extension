import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { resolveConnectionArg } from './resolveConnectionArg';
import { Connection } from './types';
import { ConnectionStore } from './connectionStore';

const connA: Connection = { name: 'A', tenantId: 't1', cloud: 'public' };
const connB: Connection = { name: 'B', tenantId: 't2', cloud: 'public' };

function fakeStore(connections: Connection[]): ConnectionStore {
  return { list: vi.fn(async () => connections) } as unknown as ConnectionStore;
}

describe('resolveConnectionArg', () => {
  it('returns the item argument directly without consulting the store', async () => {
    const store = fakeStore([connA, connB]);
    const result = await resolveConnectionArg(store, { connection: connA }, 'pick');
    expect(result).toBe(connA);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('falls back to a quick pick over all connections when no item is given', async () => {
    const store = fakeStore([connA, connB]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: 'B',
      description: 't2',
      connection: connB,
    } as never);

    const result = await resolveConnectionArg(store, undefined, 'Pick one');
    expect(result).toBe(connB);
    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'A', description: 't1', connection: connA },
        { label: 'B', description: 't2', connection: connB },
      ],
      { placeHolder: 'Pick one' }
    );
  });

  it('applies the filter before offering candidates', async () => {
    const store = fakeStore([connA, connB]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: 'A',
      description: 't1',
      connection: connA,
    } as never);

    await resolveConnectionArg(store, undefined, 'Pick', (c) => c.name === 'A');

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
      [{ label: 'A', description: 't1', connection: connA }],
      { placeHolder: 'Pick' }
    );
  });

  it('shows an info message and skips the quick pick when nothing matches the filter', async () => {
    const store = fakeStore([connA, connB]);

    const result = await resolveConnectionArg(store, undefined, 'Pick', () => false);

    expect(result).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No matching connections found.');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('returns undefined when the quick pick is cancelled', async () => {
    const store = fakeStore([connA]);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);

    const result = await resolveConnectionArg(store, undefined, 'Pick');

    expect(result).toBeUndefined();
  });
});
