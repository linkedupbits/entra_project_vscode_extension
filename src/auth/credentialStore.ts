import type { SecretStorage } from 'vscode';

function clientSecretKey(connectionName: string): string {
  return `entra.clientSecret.${connectionName}`;
}

function certificateKeyKey(connectionName: string): string {
  return `entra.clientCertificateKey.${connectionName}`;
}

/**
 * Holds the two kinds of app-only credential a connection can have (a client secret, or a
 * certificate's private key) in VS Code SecretStorage, keyed by connection name — never in
 * connections.yaml (see NonFunctionalRequirements.md and UC012). Separate from
 * secretStorageCachePlugin.ts's token cache: this is the long-lived credential itself, not a
 * session token derived from it, so disconnecting (UC011) must not delete it.
 */
export class CredentialStore {
  constructor(private readonly secrets: SecretStorage) {}

  getClientSecret(connectionName: string): Thenable<string | undefined> {
    return this.secrets.get(clientSecretKey(connectionName));
  }

  async setClientSecret(connectionName: string, value: string): Promise<void> {
    await this.secrets.store(clientSecretKey(connectionName), value);
  }

  getCertificateKey(connectionName: string): Thenable<string | undefined> {
    return this.secrets.get(certificateKeyKey(connectionName));
  }

  async setCertificateKey(connectionName: string, value: string): Promise<void> {
    await this.secrets.store(certificateKeyKey(connectionName), value);
  }

  /** Drops whichever credential(s) are stored for a connection — e.g. it switched away from an app-only auth method. */
  async clearForConnection(connectionName: string): Promise<void> {
    await this.secrets.delete(clientSecretKey(connectionName));
    await this.secrets.delete(certificateKeyKey(connectionName));
  }

  /** A connection rename changes the SecretStorage key; move whichever credential exists rather than losing it. */
  async renameConnection(oldName: string, newName: string): Promise<void> {
    const secret = await this.getClientSecret(oldName);
    if (secret !== undefined) {
      await this.setClientSecret(newName, secret);
      await this.secrets.delete(clientSecretKey(oldName));
    }
    const certificateKey = await this.getCertificateKey(oldName);
    if (certificateKey !== undefined) {
      await this.setCertificateKey(newName, certificateKey);
      await this.secrets.delete(certificateKeyKey(oldName));
    }
  }
}
