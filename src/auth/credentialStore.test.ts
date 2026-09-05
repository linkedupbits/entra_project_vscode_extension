import { describe, it, expect, vi } from 'vitest';
import type { SecretStorage } from 'vscode';
import { CredentialStore } from './credentialStore';

function fakeSecrets(initial: Record<string, string> = {}): SecretStorage {
  const store = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    onDidChange: vi.fn(),
  } as unknown as SecretStorage;
}

describe('CredentialStore', () => {
  it('stores and retrieves a client secret, namespaced by connection name', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);

    expect(await store.getClientSecret('Contoso')).toBeUndefined();
    await store.setClientSecret('Contoso', 'super-secret');

    expect(await store.getClientSecret('Contoso')).toBe('super-secret');
    expect(secrets.store).toHaveBeenCalledWith('entra.clientSecret.Contoso', 'super-secret');
  });

  it('stores and retrieves a certificate private key, namespaced by connection name', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);

    await store.setCertificateKey('Contoso', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');

    expect(await store.getCertificateKey('Contoso')).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
    expect(secrets.store).toHaveBeenCalledWith(
      'entra.clientCertificateKey.Contoso',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    );
  });

  it('clearForConnection removes both kinds of credential', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);
    await store.setClientSecret('Contoso', 'secret');
    await store.setCertificateKey('Contoso', 'key');

    await store.clearForConnection('Contoso');

    expect(await store.getClientSecret('Contoso')).toBeUndefined();
    expect(await store.getCertificateKey('Contoso')).toBeUndefined();
  });

  it('renameConnection moves a stored client secret to the new name', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);
    await store.setClientSecret('Old Name', 'secret');

    await store.renameConnection('Old Name', 'New Name');

    expect(await store.getClientSecret('Old Name')).toBeUndefined();
    expect(await store.getClientSecret('New Name')).toBe('secret');
  });

  it('renameConnection moves a stored certificate key to the new name', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);
    await store.setCertificateKey('Old Name', 'key');

    await store.renameConnection('Old Name', 'New Name');

    expect(await store.getCertificateKey('Old Name')).toBeUndefined();
    expect(await store.getCertificateKey('New Name')).toBe('key');
  });

  it('renameConnection is a no-op when nothing was stored', async () => {
    const secrets = fakeSecrets();
    const store = new CredentialStore(secrets);

    await expect(store.renameConnection('Old Name', 'New Name')).resolves.toBeUndefined();
    expect(secrets.store).not.toHaveBeenCalled();
  });
});
