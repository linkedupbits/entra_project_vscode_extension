import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeIcon, ThemeColor, MarkdownString, TreeItemCollapsibleState } from '../test/vscodeMock';
import {
  ConnectionsRootItem,
  ConnectionTreeItem,
  ConnectionsBranch,
  TenantApplicationsRootItem,
  TenantApplicationEnvironmentGroupItem,
  TenantApplicationItem,
} from './connectionsBranch';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';
import { Connection } from './types';
import { listApplications, listServicePrincipals } from '../graph/graphClient';

vi.mock('../graph/graphClient', () => ({ listApplications: vi.fn(), listServicePrincipals: vi.fn() }));

beforeEach(() => {
  vi.mocked(listApplications).mockResolvedValue([]);
  vi.mocked(listServicePrincipals).mockResolvedValue([]);
});

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

  it('is expandable when connected, to show its Applications folder', () => {
    const item = new ConnectionTreeItem(connA, true);
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
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

  it('is a leaf when disconnected — nothing to browse until connected', () => {
    const item = new ConnectionTreeItem(connA, false);
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });
});

describe('TenantApplicationsRootItem', () => {
  it('is a collapsed folder labelled Applications, carrying its connection', () => {
    const item = new TenantApplicationsRootItem(connA);
    expect(item.label).toBe('Applications');
    expect(item.contextValue).toBe('tenantApplicationsRoot');
    expect(item.connection).toBe(connA);
  });
});

describe('TenantApplicationEnvironmentGroupItem', () => {
  it('is a collapsed group labelled by its environment, carrying its connection and applications', () => {
    const apps = [{ id: '1', appId: 'a', displayName: 'Alpha App' }];
    const item = new TenantApplicationEnvironmentGroupItem(connA, 'prod', apps);
    expect(item.label).toBe('Environment: prod');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    expect(item.contextValue).toBe('tenantApplicationEnvironmentGroup');
    expect(item.connection).toBe(connA);
    expect(item.applications).toBe(apps);
    expect(item.description).toBe('1 application');
    expect(item.iconPath).toBeInstanceOf(ThemeIcon);
  });
});

describe('TenantApplicationItem', () => {
  it('labels by display name, describes by appId, and shows both plus the object ID in its tooltip', () => {
    const item = new TenantApplicationItem(connA, { id: 'obj-1', appId: 'app-1', displayName: 'My App' });
    expect(item.label).toBe('My App');
    expect(item.description).toBe('app-1');
    expect((item.tooltip as MarkdownString).value).toContain('My App');
    expect((item.tooltip as MarkdownString).value).toContain('app-1');
    expect((item.tooltip as MarkdownString).value).toContain('obj-1');
  });

  it('falls back to the appId as the label when displayName is blank', () => {
    const item = new TenantApplicationItem(connA, { id: 'obj-1', appId: 'app-1', displayName: '' });
    expect(item.label).toBe('app-1');
  });

  it('runs entra.previewArtifact with its connection and application when clicked', () => {
    const application = { id: 'obj-1', appId: 'app-1', displayName: 'My App' };
    const item = new TenantApplicationItem(connA, application);
    expect(item.command).toEqual({
      command: 'entra.previewArtifact',
      title: 'Preview',
      arguments: [{ connection: connA, application }],
    });
  });
});

describe('ConnectionsBranch', () => {
  function branch(
    connections: Connection[],
    connectedNames: string[] = [],
    getGraphAccessToken: (...args: unknown[]) => unknown = vi.fn(async () => 'a-token')
  ): ConnectionsBranch {
    const store = { list: vi.fn(async () => connections) } as unknown as ConnectionStore;
    const auth = {
      isConnected: (name: string) => connectedNames.includes(name),
      getGraphAccessToken,
    } as unknown as AuthService;
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

  it('returns no children for an element it does not recognize', async () => {
    const children = await branch([]).getChildren(new TenantApplicationItem(connA, { id: '1', appId: 'a', displayName: 'A' }));
    expect(children).toEqual([]);
  });

  describe('owns', () => {
    it('owns a ConnectionTreeItem, a TenantApplicationsRootItem and an environment group, but not a leaf application', () => {
      const b = branch([]);
      expect(b.owns(new ConnectionTreeItem(connA, true))).toBe(true);
      expect(b.owns(new TenantApplicationsRootItem(connA))).toBe(true);
      expect(b.owns(new TenantApplicationEnvironmentGroupItem(connA, 'prod', []))).toBe(true);
      expect(b.owns(new TenantApplicationItem(connA, { id: '1', appId: 'a', displayName: 'A' }))).toBe(false);
    });
  });

  describe('getChildren(ConnectionTreeItem)', () => {
    it("shows the Applications folder for a connected connection's node", async () => {
      const children = await branch([], ['Bravo']).getChildren(new ConnectionTreeItem(connA, true));
      expect(children).toHaveLength(1);
      expect(children[0]).toBeInstanceOf(TenantApplicationsRootItem);
      expect((children[0] as TenantApplicationsRootItem).connection).toBe(connA);
    });

    it('shows no children for a disconnected connection node', async () => {
      const children = await branch([], []).getChildren(new ConnectionTreeItem(connA, false));
      expect(children).toEqual([]);
    });
  });

  describe('getChildren(TenantApplicationsRootItem)', () => {
    it('lists applications from Graph, sorted by display name', async () => {
      vi.mocked(listApplications).mockResolvedValueOnce([
        { id: '2', appId: 'b', displayName: 'Bravo App' },
        { id: '1', appId: 'a', displayName: 'Alpha App' },
      ]);

      const children = (await branch([]).getChildren(
        new TenantApplicationsRootItem(connA)
      )) as TenantApplicationItem[];

      expect(children.map((c) => c.label)).toEqual(['Alpha App', 'Bravo App']);
    });

    it('passes the access token and cloud through to listApplications', async () => {
      const getGraphAccessToken = vi.fn(async () => 'the-token');
      vi.mocked(listApplications).mockResolvedValueOnce([]);

      await branch([], [], getGraphAccessToken).getChildren(new TenantApplicationsRootItem(connA));

      expect(getGraphAccessToken).toHaveBeenCalledWith(connA);
      expect(listApplications).toHaveBeenCalledWith('the-token', connA.cloud);
    });

    it('shows a placeholder when the tenant has no applications', async () => {
      vi.mocked(listApplications).mockResolvedValueOnce([]);

      const children = await branch([]).getChildren(new TenantApplicationsRootItem(connA));

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe('tenantApplicationsEmptyPlaceholder');
    });

    it('shows an error item instead of throwing when Graph or token acquisition fails', async () => {
      const getGraphAccessToken = vi.fn(async () => {
        throw new Error('Not connected to "Bravo".');
      });

      const children = await branch([], [], getGraphAccessToken).getChildren(new TenantApplicationsRootItem(connA));

      expect(children).toHaveLength(1);
      expect(children[0].contextValue).toBe('tenantApplicationsError');
      expect(children[0].description).toContain('Not connected to "Bravo"');
    });

    it('stringifies a non-Error thrown while loading applications', async () => {
      const getGraphAccessToken = vi.fn(async () => {
        throw 'plain string failure';
      });

      const children = await branch([], [], getGraphAccessToken).getChildren(new TenantApplicationsRootItem(connA));

      expect(children[0].contextValue).toBe('tenantApplicationsError');
      expect(children[0].description).toBe('plain string failure');
    });

    it('groups applications by their service principal\'s Environment: tag, groups first then ungrouped', async () => {
      vi.mocked(listApplications).mockResolvedValueOnce([
        { id: '1', appId: 'a', displayName: 'Alpha App' },
        { id: '2', appId: 'b', displayName: 'Bravo App' },
        { id: '3', appId: 'c', displayName: 'Charlie App' },
        { id: '4', appId: 'd', displayName: 'Delta App' },
      ]);
      vi.mocked(listServicePrincipals).mockResolvedValueOnce([
        { id: 'sp1', appId: 'a', displayName: 'Alpha App', tags: ['Environment:prod', 'AppName:prod_hr_alpha'] },
        { id: 'sp2', appId: 'b', displayName: 'Bravo App', tags: ['Environment:dev'] },
        { id: 'sp3', appId: 'c', displayName: 'Charlie App', tags: ['Environment:prod'] },
        // Delta App has no service principal at all → ungrouped
      ]);

      const children = await branch([]).getChildren(new TenantApplicationsRootItem(connA));

      expect(children.map((c) => [c.contextValue, c.label])).toEqual([
        ['tenantApplicationEnvironmentGroup', 'Environment: dev'],
        ['tenantApplicationEnvironmentGroup', 'Environment: prod'],
        ['tenantApplication', 'Delta App'],
      ]);
      const prod = children[1] as TenantApplicationEnvironmentGroupItem;
      expect(prod.applications.map((a) => a.displayName)).toEqual(['Alpha App', 'Charlie App']);
      expect(prod.description).toBe('2 applications');
    });

    it('treats a blank or whitespace-only Environment: tag value as ungrouped', async () => {
      vi.mocked(listApplications).mockResolvedValueOnce([{ id: '1', appId: 'a', displayName: 'Alpha App' }]);
      vi.mocked(listServicePrincipals).mockResolvedValueOnce([
        { id: 'sp1', appId: 'a', displayName: 'Alpha App', tags: ['Environment:   '] },
      ]);

      const children = await branch([]).getChildren(new TenantApplicationsRootItem(connA));

      expect(children.map((c) => c.contextValue)).toEqual(['tenantApplication']);
    });

    it('falls back to a flat list when listing service principals fails', async () => {
      vi.mocked(listApplications).mockResolvedValueOnce([
        { id: '2', appId: 'zeta-app-id', displayName: '' },
        { id: '1', appId: 'alpha-app-id', displayName: '' },
      ]);
      vi.mocked(listServicePrincipals).mockRejectedValueOnce(new Error('Insufficient privileges'));

      const children = await branch([]).getChildren(new TenantApplicationsRootItem(connA));

      // sorted by display name, each falling back to its appId when the display name is blank
      expect(children.map((c) => [c.contextValue, c.label])).toEqual([
        ['tenantApplication', 'alpha-app-id'],
        ['tenantApplication', 'zeta-app-id'],
      ]);
    });
  });

  describe('getChildren(TenantApplicationEnvironmentGroupItem)', () => {
    it('returns one TenantApplicationItem per application it carries, in the order stored', async () => {
      const group = new TenantApplicationEnvironmentGroupItem(connA, 'prod', [
        { id: '1', appId: 'a', displayName: 'Alpha App' },
        { id: '2', appId: 'b', displayName: 'Bravo App' },
      ]);

      const children = (await branch([]).getChildren(group)) as TenantApplicationItem[];

      expect(children.every((c) => c instanceof TenantApplicationItem)).toBe(true);
      expect(children.map((c) => c.label)).toEqual(['Alpha App', 'Bravo App']);
      expect(children[0].connection).toBe(connA);
    });
  });
});
