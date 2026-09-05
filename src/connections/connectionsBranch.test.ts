import { describe, it, expect, vi } from 'vitest';
import { ThemeIcon, ThemeColor, MarkdownString } from '../test/vscodeMock';
import { ConnectionsRootItem, ConnectionTreeItem, ConnectionsBranch } from './connectionsBranch';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';
import { Connection } from './types';

const connA: Connection = { name: 'Bravo', tenantId: 't-bravo', cloud: 'public' };
const connB: Connection = { name: 'Alpha', tenantId: 't-alpha', cloud: 'usGov' };

describe('ConnectionsRootItem', () => {
  it('is an expanded root labelled Connections', () => {
    const item = new ConnectionsRootItem();
    expect(item.label).toBe('Connections');
    expect(item.contextValue).toBe('connectionsRoot');
    expect(item.iconPath).toBeInstanceOf(ThemeIcon);
  });
});

describe('ConnectionTreeItem', () => {
  it('reflects a connected connection', () => {
    const item = new ConnectionTreeItem(connA, true);
    expect(item.label).toBe('Bravo');
    expect(item.description).toBe('t-bravo');
    expect(item.contextValue).toBe('connection-connected');
    const icon = item.iconPath as ThemeIcon;
    expect(icon.id).toBe('plug');
    expect(icon.color).toBeInstanceOf(ThemeColor);
    expect((item.tooltip as MarkdownString).value).toContain('Connected');
  });

  it('opens the Edit Connection webview when clicked', () => {
    const item = new ConnectionTreeItem(connA, true);
    expect(item.command).toEqual({
      command: 'entra.editConnection',
      title: 'Edit Connection',
      arguments: [{ connection: connA }],
    });
  });

  it('reflects a disconnected connection', () => {
    const item = new ConnectionTreeItem(connA, false);
    expect(item.contextValue).toBe('connection-disconnected');
    const icon = item.iconPath as ThemeIcon;
    expect(icon.id).toBe('circle-large-outline');
    expect(icon.color).toBeUndefined();
    expect((item.tooltip as MarkdownString).value).toContain('Not connected');
  });
});

describe('ConnectionsBranch', () => {
  function branch(connections: Connection[], connectedNames: string[] = []): ConnectionsBranch {
    const store = { list: vi.fn(async () => connections) } as unknown as ConnectionStore;
    const auth = { isConnected: (name: string) => connectedNames.includes(name) } as unknown as AuthService;
    return new ConnectionsBranch(store, auth);
  }

  it('shows an "add one" placeholder when there are no connections', async () => {
    const children = await branch([]).getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('connectionsEmptyPlaceholder');
    expect(children[0].command?.command).toBe('entra.addConnection');
  });

  it('lists connections sorted by name, each reflecting its connected state', async () => {
    const children = (await branch([connA, connB], ['Bravo']).getChildren()) as ConnectionTreeItem[];
    expect(children.map((c) => c.label)).toEqual(['Alpha', 'Bravo']);
    expect(children[0].contextValue).toBe('connection-disconnected');
    expect(children[1].contextValue).toBe('connection-connected');
  });
});
