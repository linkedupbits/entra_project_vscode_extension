// Hand-rolled stand-in for the 'vscode' module, used only at test-run time (see the `resolve.alias`
// in vitest.config.ts — this never affects real builds or tsc's type-checking, both of which keep
// resolving 'vscode' to the real @types/vscode ambient declaration). Implements just enough of the
// runtime surface actually used under src/ (see the grep audit that produced this list) so unit
// tests can exercise real logic without an actual VS Code host. Reset between tests with
// resetVscodeMock() so mock state/call history doesn't leak across test cases.
import { vi } from 'vitest';

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

export class FileSystemError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FileSystemError';
  }

  static FileNotFound(): FileSystemError {
    return new FileSystemError('FileNotFound');
  }

  static NoPermissions(message?: string): FileSystemError {
    return new FileSystemError(message ?? 'NoPermissions');
  }

  static Unavailable(message?: string): FileSystemError {
    return new FileSystemError(message ?? 'Unavailable');
  }
}

export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}

  dispose(): void {
    this.callOnDispose();
  }
}

export const FileChangeType = { Changed: 1, Created: 2, Deleted: 3 } as const;

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export class TreeItem {
  description?: string;
  contextValue?: string;
  iconPath?: unknown;
  tooltip?: unknown;
  command?: unknown;
  resourceUri?: unknown;

  constructor(
    public label: string,
    public collapsibleState?: number
  ) {}
}

export class ThemeIcon {
  constructor(
    public id: string,
    public color?: unknown
  ) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  constructor(public value?: string) {}
}

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ViewColumn = { Active: -1 } as const;
export const ProgressLocation = { Notification: 15 } as const;

interface FakeUri {
  fsPath: string;
  path: string;
  scheme?: string;
  query?: string;
  toString(): string;
}

function makeFakeUri(fsPath: string): FakeUri {
  return { fsPath, path: fsPath, toString: () => fsPath };
}

export const Uri = {
  joinPath: (base: { fsPath: string }, ...segments: string[]): FakeUri =>
    makeFakeUri([base.fsPath, ...segments].join('/')),
  parse: (value: string): FakeUri => makeFakeUri(value),
  file: (value: string): FakeUri => makeFakeUri(value),
  from: (components: { scheme: string; authority?: string; path: string; query?: string }): FakeUri => ({
    scheme: components.scheme,
    path: components.path,
    query: components.query,
    fsPath: components.path,
    toString: () =>
      `${components.scheme}://${components.authority ?? ''}${components.path}${components.query ? `?${components.query}` : ''}`,
  }),
};

export const workspace = {
  workspaceFolders: undefined as Array<{ uri: FakeUri }> | undefined,
  getConfiguration: vi.fn(),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createDirectory: vi.fn(),
    readDirectory: vi.fn(),
    delete: vi.fn(),
  },
  registerFileSystemProvider: vi.fn(),
  openTextDocument: vi.fn(),
};

export const window = {
  createStatusBarItem: vi.fn(),
  createTreeView: vi.fn(),
  createWebviewPanel: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showTextDocument: vi.fn(),
  withProgress: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const env = {
  openExternal: vi.fn(),
};

export function resetVscodeMock(): void {
  workspace.workspaceFolders = undefined;
  workspace.getConfiguration.mockReset();
  workspace.fs.readFile.mockReset();
  workspace.fs.writeFile.mockReset();
  workspace.fs.createDirectory.mockReset();
  workspace.fs.readDirectory.mockReset();
  workspace.fs.delete.mockReset();
  workspace.registerFileSystemProvider.mockReset().mockReturnValue({ dispose: vi.fn() });
  workspace.openTextDocument.mockReset();

  window.createStatusBarItem.mockReset();
  window.createTreeView.mockReset().mockReturnValue({ dispose: vi.fn() });
  window.createWebviewPanel.mockReset();
  window.showInformationMessage.mockReset();
  window.showErrorMessage.mockReset();
  window.showWarningMessage.mockReset();
  window.showQuickPick.mockReset();
  window.showInputBox.mockReset();
  window.showTextDocument.mockReset();
  window.withProgress.mockReset().mockImplementation(
    async (_options: unknown, task: (progress: unknown, token: unknown) => unknown) => task({}, {})
  );

  commands.registerCommand.mockReset().mockReturnValue({ dispose: vi.fn() });
  commands.executeCommand.mockReset();
  env.openExternal.mockReset();
}

resetVscodeMock();
