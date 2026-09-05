import { describe, it, expect, vi } from 'vitest';
import type { SecretStorage } from 'vscode';
import type { TokenCacheContext } from '@azure/msal-node';
import { SecretStorageCachePlugin, tokenCacheKey } from './secretStorageCachePlugin';

function fakeSecrets(): SecretStorage {
  return {
    get: vi.fn(),
    store: vi.fn(),
    delete: vi.fn(),
    onDidChange: vi.fn(),
  } as unknown as SecretStorage;
}

function fakeCacheContext(cacheHasChanged: boolean): TokenCacheContext {
  return {
    cacheHasChanged,
    tokenCache: {
      serialize: vi.fn(() => 'serialized-blob'),
      deserialize: vi.fn(),
    },
  } as unknown as TokenCacheContext;
}

describe('tokenCacheKey', () => {
  it('namespaces the key by connection name', () => {
    expect(tokenCacheKey('Contoso Dev')).toBe('entra.tokenCache.Contoso Dev');
  });
});

describe('SecretStorageCachePlugin', () => {
  describe('beforeCacheAccess', () => {
    it('deserializes a previously stored cache blob', async () => {
      const secrets = fakeSecrets();
      vi.mocked(secrets.get).mockResolvedValue('stored-blob');
      const plugin = new SecretStorageCachePlugin(secrets, 'entra.tokenCache.A');
      const context = fakeCacheContext(false);

      await plugin.beforeCacheAccess(context);

      expect(secrets.get).toHaveBeenCalledWith('entra.tokenCache.A');
      expect(context.tokenCache.deserialize).toHaveBeenCalledWith('stored-blob');
    });

    it('does nothing when there is no stored cache yet', async () => {
      const secrets = fakeSecrets();
      vi.mocked(secrets.get).mockResolvedValue(undefined);
      const plugin = new SecretStorageCachePlugin(secrets, 'entra.tokenCache.A');
      const context = fakeCacheContext(false);

      await plugin.beforeCacheAccess(context);

      expect(context.tokenCache.deserialize).not.toHaveBeenCalled();
    });
  });

  describe('afterCacheAccess', () => {
    it('persists the serialized cache when it changed', async () => {
      const secrets = fakeSecrets();
      const plugin = new SecretStorageCachePlugin(secrets, 'entra.tokenCache.A');
      const context = fakeCacheContext(true);

      await plugin.afterCacheAccess(context);

      expect(secrets.store).toHaveBeenCalledWith('entra.tokenCache.A', 'serialized-blob');
    });

    it('does not write when the cache did not change', async () => {
      const secrets = fakeSecrets();
      const plugin = new SecretStorageCachePlugin(secrets, 'entra.tokenCache.A');
      const context = fakeCacheContext(false);

      await plugin.afterCacheAccess(context);

      expect(secrets.store).not.toHaveBeenCalled();
    });
  });
});
