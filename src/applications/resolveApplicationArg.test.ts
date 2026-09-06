import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { ApplicationsBranch } from './applicationsBranch';
import { resolveApplicationArg } from './resolveApplicationArg';

vi.mock('../workspacePaths', () => ({ getApplicationsRootUri: vi.fn() }));
import { getApplicationsRootUri } from '../workspacePaths';

const rootUri = { fsPath: '/repo/entra/Applications', toString: () => '/repo/entra/Applications' };

function fakeBranch(names: string[]): ApplicationsBranch {
  return { listApplicationNames: vi.fn(async () => names) } as unknown as ApplicationsBranch;
}

describe('resolveApplicationArg', () => {
  it('uses the tree item when one is passed, without a quick pick', async () => {
    const item = { folderUri: rootUri as never, name: 'sample-web-app' };
    const result = await resolveApplicationArg(fakeBranch([]), item, 'pick');
    expect(result).toEqual(item);
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('falls back to a quick pick over the application names when no item is passed', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce('sample-api' as never);

    const result = await resolveApplicationArg(fakeBranch(['sample-api', 'sample-web-app']), undefined, 'pick');

    expect(vscode.window.showQuickPick).toHaveBeenCalledWith(['sample-api', 'sample-web-app'], { placeHolder: 'pick' });
    expect(result?.name).toBe('sample-api');
    expect(result?.folderUri.fsPath).toBe('/repo/entra/Applications/sample-api');
  });

  it('returns undefined and informs the user when there are no applications', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    const result = await resolveApplicationArg(fakeBranch([]), undefined, 'pick');
    expect(result).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('returns undefined when the user cancels the quick pick', async () => {
    vi.mocked(getApplicationsRootUri).mockReturnValue(rootUri as never);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined as never);
    const result = await resolveApplicationArg(fakeBranch(['sample-api']), undefined, 'pick');
    expect(result).toBeUndefined();
  });
});
