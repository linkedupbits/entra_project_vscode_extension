import type { SecretStorage } from 'vscode';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

export function tokenCacheKey(connectionName: string): string {
  return `entra.tokenCache.${connectionName}`;
}

/**
 * Persists one connection's MSAL token cache through VS Code SecretStorage, never to a project
 * file — see NonFunctionalRequirements.md ("all secrets must be stored using VS Code's secret
 * storage") and UC010.
 */
export class SecretStorageCachePlugin implements ICachePlugin {
  constructor(
    private readonly secrets: SecretStorage,
    private readonly key: string
  ) {}

  async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    const cached = await this.secrets.get(this.key);
    if (cached) {
      cacheContext.tokenCache.deserialize(cached);
    }
  }

  async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (cacheContext.cacheHasChanged) {
      await this.secrets.store(this.key, cacheContext.tokenCache.serialize());
    }
  }
}
