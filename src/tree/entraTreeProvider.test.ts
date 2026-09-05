import { describe, it, expect, vi } from 'vitest';
import { TreeItem } from '../test/vscodeMock';
import { EntraTreeProvider } from './entraTreeProvider';
import { ConnectionsBranch } from '../connections/connectionsBranch';
import { ProjectBranch } from '../project/projectBranch';

describe('EntraTreeProvider', () => {
  function makeProvider() {
    const connectionChild = new TreeItem('a connection') as never;
    const projectChild = new TreeItem('a project item') as never;
    const connectionsBranch = {
      getChildren: vi.fn(async () => [connectionChild]),
      owns: vi.fn(() => false),
    } as unknown as ConnectionsBranch;
    const projectBranch = {
      getChildren: vi.fn(async () => [projectChild]),
      owns: vi.fn(() => false),
    } as unknown as ProjectBranch;
    const provider = new EntraTreeProvider(connectionsBranch, projectBranch);
    return { provider, connectionsBranch, projectBranch, connectionChild, projectChild };
  }

  it('getTreeItem returns the element unchanged', () => {
    const { provider } = makeProvider();
    const item = new TreeItem('x') as never;
    expect(provider.getTreeItem(item)).toBe(item);
  });

  it('the root has exactly the Connections and Project nodes', async () => {
    const { provider } = makeProvider();
    const roots = await provider.getChildren();
    expect(roots.map((r) => r.contextValue)).toEqual(['connectionsRoot', 'projectRoot']);
  });

  it('delegates the Connections root to the connections branch', async () => {
    const { provider, connectionsBranch, connectionChild } = makeProvider();
    const [connectionsRoot] = await provider.getChildren();

    const children = await provider.getChildren(connectionsRoot);

    expect(connectionsBranch.getChildren).toHaveBeenCalledTimes(1);
    expect(children).toEqual([connectionChild]);
  });

  it('delegates the Project root to the project branch', async () => {
    const { provider, projectBranch, projectChild } = makeProvider();
    const [, projectRoot] = await provider.getChildren();

    const children = await provider.getChildren(projectRoot);

    expect(projectBranch.getChildren).toHaveBeenCalledTimes(1);
    expect(children).toEqual([projectChild]);
  });

  it('returns no children for an unrecognised element', async () => {
    const { provider } = makeProvider();
    const children = await provider.getChildren(new TreeItem('mystery') as never);
    expect(children).toEqual([]);
  });

  it('delegates a deeper element the connections branch owns back to it, with that element', async () => {
    const { provider, connectionsBranch } = makeProvider();
    vi.mocked(connectionsBranch.owns).mockReturnValue(true);
    const deepElement = new TreeItem('a tenant application') as never;

    await provider.getChildren(deepElement);

    expect(connectionsBranch.owns).toHaveBeenCalledWith(deepElement);
    expect(connectionsBranch.getChildren).toHaveBeenCalledWith(deepElement);
  });

  it('delegates a deeper element the project branch owns back to it, with that element', async () => {
    const { provider, projectBranch } = makeProvider();
    vi.mocked(projectBranch.owns).mockReturnValue(true);
    const deepElement = new TreeItem('an application') as never;

    await provider.getChildren(deepElement);

    expect(projectBranch.owns).toHaveBeenCalledWith(deepElement);
    expect(projectBranch.getChildren).toHaveBeenCalledWith(deepElement);
  });

  it('refresh fires the change event', () => {
    const { provider } = makeProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.refresh();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
