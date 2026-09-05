import { describe, it, expect, vi } from 'vitest';
import { ProjectRootItem, ProjectBranch } from './projectBranch';
import { ApplicationsBranch, ApplicationItem } from '../applications/applicationsBranch';

function fakeApplicationsBranch(): ApplicationsBranch {
  return {
    getChildren: vi.fn(async () => []),
    getFiles: vi.fn(async () => []),
  } as unknown as ApplicationsBranch;
}

describe('ProjectRootItem', () => {
  it('is a collapsed root labelled Project', () => {
    const item = new ProjectRootItem();
    expect(item.label).toBe('Project');
    expect(item.contextValue).toBe('projectRoot');
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

  it('owns an ApplicationItem', () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const appItem = new ApplicationItem({ fsPath: '/x' } as never, 'sample');
    expect(branch.owns(appItem)).toBe(true);
  });

  it('delegates the Applications root to ApplicationsBranch.getChildren', async () => {
    const applicationsBranch = fakeApplicationsBranch();
    const branch = new ProjectBranch(applicationsBranch);
    const [applicationsRoot] = await branch.getChildren();

    await branch.getChildren(applicationsRoot);

    expect(applicationsBranch.getChildren).toHaveBeenCalledTimes(1);
  });

  it('delegates an ApplicationItem to ApplicationsBranch.getFiles', async () => {
    const applicationsBranch = fakeApplicationsBranch();
    const branch = new ProjectBranch(applicationsBranch);
    const appItem = new ApplicationItem({ fsPath: '/x' } as never, 'sample');

    await branch.getChildren(appItem);

    expect(applicationsBranch.getFiles).toHaveBeenCalledWith(appItem);
  });

  it('returns no children for an unrecognised element', async () => {
    const branch = new ProjectBranch(fakeApplicationsBranch());
    const children = await branch.getChildren(new ProjectRootItem());
    expect(children).toEqual([]);
  });
});
