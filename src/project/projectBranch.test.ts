import { describe, it, expect, vi } from 'vitest';
import { TreeItemCollapsibleState } from '../test/vscodeMock';
import { ProjectRootItem, ProjectBranch } from './projectBranch';
import { ApplicationsBranch, ApplicationItem } from '../applications/applicationsBranch';

function fakeApplicationsBranch(): ApplicationsBranch {
  return {
    getChildren: vi.fn(async () => []),
  } as unknown as ApplicationsBranch;
}

describe('ProjectRootItem', () => {
  it('is an expanded root labelled Project', () => {
    const item = new ProjectRootItem();
    expect(item.label).toBe('Project');
    expect(item.contextValue).toBe('projectRoot');
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
  });
});

describe('ProjectBranch', () => {
  it('has a single top-level child: the Applications node', async () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const children = await branch.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('applicationsRoot');
  });

  it('owns the Applications root but not the Project root or unrelated items', async () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const [applicationsRoot] = await branch.getChildren();
    expect(branch.owns(applicationsRoot)).toBe(true);
    expect(branch.owns(new ProjectRootItem())).toBe(false);
  });

  it('does not own an ApplicationItem — it is a leaf with no children to delegate to', () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const appItem = new ApplicationItem({ fsPath: '/x' } as never, 'sample');
    expect(branch.owns(appItem)).toBe(false);
  });

  it('delegates the Applications root to ApplicationsBranch.getChildren', async () => {
    const applicationsBranch = fakeApplicationsBranch();
    const branch = new ProjectBranch(applicationsBranch);
    const [applicationsRoot] = await branch.getChildren();

    await branch.getChildren(applicationsRoot);

    expect(applicationsBranch.getChildren).toHaveBeenCalledTimes(1);
  });

  it('returns no children for an unrecognised element', async () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const children = await branch.getChildren(new ProjectRootItem());
    expect(children).toEqual([]);
  });

  it('returns no children for an ApplicationItem', async () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const appItem = new ApplicationItem({ fsPath: '/x' } as never, 'sample');
    const children = await branch.getChildren(appItem);
    expect(children).toEqual([]);
  });
});
