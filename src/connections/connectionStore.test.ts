import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as YAML from 'yaml';
import { FileSystemError } from '../test/vscodeMock';
import { ConnectionStore } from './connectionStore';
import { Connection } from './types';

const rootUri = { fsPath: '/repo/entra', toString: () => '/repo/entra' };
const fileUri = { fsPath: '/repo/entra/connections.yaml', toString: () => '/repo/entra/connections.yaml' };

vi.mock('../workspacePaths', () => ({
  getArtifactsRootUri: vi.fn(),
  getConnectionsFileUri: vi.fn(),
}));

import { getArtifactsRootUri, getConnectionsFileUri } from '../workspacePaths';

function givenWorkspaceOpen(): void {
  vi.mocked(getArtifactsRootUri).mockReturnValue(rootUri as never);
  vi.mocked(getConnectionsFileUri).mockReturnValue(fileUri as never);
}

function givenNoWorkspace(): void {
  vi.mocked(getArtifactsRootUri).mockReturnValue(undefined);
  vi.mocked(getConnectionsFileUri).mockReturnValue(undefined);
}

const connA: Connection = { name: 'Contoso Dev', tenantId: 't1', cloud: 'public' };
const connB: Connection = { name: 'Fabrikam Prod', tenantId: 't2', cloud: 'usGov' };

describe('ConnectionStore', () => {
  let store: ConnectionStore;

  beforeEach(() => {
    store = new ConnectionStore();
  });

  describe('list', () => {
    it('returns an empty array when no workspace is open', async () => {
      givenNoWorkspace();
      expect(await store.list()).toEqual([]);
      expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    });

    it('returns an empty array when connections.yaml does not exist yet', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(FileSystemError.FileNotFound());
      expect(await store.list()).toEqual([]);
    });

    it('rethrows other filesystem errors', async () => {
      givenWorkspaceOpen();
      const boom = new Error('disk on fire');
      vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(boom);
      await expect(store.list()).rejects.toBe(boom);
    });

    it('parses a valid connections.yaml array', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        Buffer.from(YAML.stringify([connA, connB]), 'utf8')
      );
      expect(await store.list()).toEqual([connA, connB]);
    });

    it('treats a non-array YAML body as no connections', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(Buffer.from('name: not-a-list\n', 'utf8'));
      expect(await store.list()).toEqual([]);
    });
  });

  describe('add', () => {
    it('rejects a duplicate name, case-insensitively', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA]), 'utf8'));

      await expect(store.add({ name: 'contoso dev', tenantId: 'x', cloud: 'public' })).rejects.toThrow(
        'A connection named "contoso dev" already exists.'
      );
      expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });

    it('appends and persists a new connection, firing onDidChange', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA]), 'utf8'));
      const listener = vi.fn();
      store.onDidChange(listener);

      await store.add(connB);

      expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(rootUri);
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      const [writtenUri, writtenBytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(writtenUri).toBe(fileUri);
      const writtenText = Buffer.from(writtenBytes as Uint8Array).toString('utf8');
      // Actually YAML block style, not just JSON text that happens to parse as YAML too.
      expect(writtenText).toContain('- name: Contoso Dev');
      expect(YAML.parse(writtenText)).toEqual([connA, connB]);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('throws a clear error when no workspace is open', async () => {
      givenNoWorkspace();
      await expect(store.add(connA)).rejects.toThrow('Open a folder before managing Entra connections.');
    });
  });

  describe('update', () => {
    it('throws when the original name does not exist', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA]), 'utf8'));

      await expect(store.update('Nonexistent', connA)).rejects.toThrow('No connection named "Nonexistent" was found.');
    });

    it('throws when renaming into another existing connection', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA, connB]), 'utf8'));

      await expect(store.update('Contoso Dev', { ...connA, name: 'Fabrikam Prod' })).rejects.toThrow(
        'A connection named "Fabrikam Prod" already exists.'
      );
    });

    it('replaces the entry in place, keeping the same name allowed', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA, connB]), 'utf8'));

      const updated: Connection = { ...connA, tenantId: 'updated-tenant' };
      await store.update('Contoso Dev', updated);

      const [, writtenBytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(YAML.parse(Buffer.from(writtenBytes as Uint8Array).toString('utf8'))).toEqual([updated, connB]);
    });
  });

  describe('remove', () => {
    it('filters out the named connection and saves the rest', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([connA, connB]), 'utf8'));

      await store.remove('Contoso Dev');

      const [, writtenBytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
      expect(YAML.parse(Buffer.from(writtenBytes as Uint8Array).toString('utf8'))).toEqual([connB]);
    });
  });

  describe('dispose', () => {
    it('stops onDidChange listeners from firing afterwards', async () => {
      givenWorkspaceOpen();
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(YAML.stringify([]), 'utf8'));
      const listener = vi.fn();
      store.onDidChange(listener);

      store.dispose();
      await store.add(connA);

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
