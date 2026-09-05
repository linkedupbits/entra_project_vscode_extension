import { describe, it, expect } from 'vitest';
import { ThemeIcon } from '../test/vscodeMock';
import { ProjectRootItem, ProjectBranch } from './projectBranch';

describe('ProjectRootItem', () => {
  it('is a collapsed root labelled Project', () => {
    const item = new ProjectRootItem();
    expect(item.label).toBe('Project');
    expect(item.contextValue).toBe('projectRoot');
    expect(item.iconPath).toBeInstanceOf(ThemeIcon);
  });
});

describe('ProjectBranch', () => {
  it('shows a placeholder until download is implemented', async () => {
    const children = await new ProjectBranch().getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe('No artifacts downloaded yet');
    expect(children[0].contextValue).toBe('projectEmptyPlaceholder');
  });
});
