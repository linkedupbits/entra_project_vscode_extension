import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { SecretStorage } from 'vscode';
import { Connection } from '../connections/types';

const mocks = vi.hoisted(() => ({
  cachedAccounts: [] as unknown[],
  acquireTokenSilent: vi.fn(),
  acquireTokenByDeviceCode: vi.fn(),
  acquireTokenInteractive: vi.fn(),
  acquireTokenByClientCredential: vi.fn(),
  removeAccount: vi.fn(),
  publicConfigs: [] as Array<{ auth: { clientId: string; authority: string } }>,
  confidentialConfigs: [] as Array<{
    auth: {
      clientId: string;
      authority: string;
      clientSecret?: string;
      clientCertificate?: { thumbprint?: string; thumbprintSha256?: string; privateKey: string };
    };
  }>,
}));

vi.mock('@azure/msal-node', () => {
  class FakePublicClientApplication {
    constructor(config: { auth: { clientId: string; authority: string } }) {
      mocks.publicConfigs.push(config);
    }
    getTokenCache() {
      return {
        getAllAccounts: async () => mocks.cachedAccounts,
        removeAccount: mocks.removeAccount,
      };
    }
    acquireTokenSilent(...args: unknown[]) {
      return mocks.acquireTokenSilent(...args);
    }
    acquireTokenByDeviceCode(...args: unknown[]) {
      return mocks.acquireTokenByDeviceCode(...args);
    }
    acquireTokenInteractive(...args: unknown[]) {
      return mocks.acquireTokenInteractive(...args);
    }
  }
  class FakeConfidentialClientApplication {
    constructor(config: (typeof mocks.confidentialConfigs)[number]) {
      mocks.confidentialConfigs.push(config);
    }
    acquireTokenByClientCredential(...args: unknown[]) {
      return mocks.acquireTokenByClientCredential(...args);
    }
  }
  return {
    PublicClientApplication: FakePublicClientApplication,
    ConfidentialClientApplication: FakeConfidentialClientApplication,
  };
});

vi.mock('../config', () => ({
  getAuthMode: vi.fn(() => 'interactive'),
  getDefaultClientId: vi.fn(() => ''),
}));

import { getAuthMode, getDefaultClientId } from '../config';
import { AuthService } from './authService';
import { CredentialStore } from './credentialStore';

function fakeSecrets(): SecretStorage {
  const store = new Map<string, string>();
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

function makeAuth(secrets: SecretStorage = fakeSecrets()) {
  const credentials = new CredentialStore(secrets);
  return { auth: new AuthService(secrets, credentials), secrets, credentials };
}

const publicConn: Connection = { name: 'Contoso Dev', tenantId: 'contoso-tenant', cloud: 'public' };

beforeEach(() => {
  mocks.cachedAccounts = [];
  mocks.publicConfigs.length = 0;
  mocks.confidentialConfigs.length = 0;
  vi.mocked(getAuthMode).mockReturnValue('interactive');
  vi.mocked(getDefaultClientId).mockReturnValue('');
});

describe('AuthService.connect — delegated', () => {
  it('throws when no client ID is configured anywhere', async () => {
    const { auth } = makeAuth();
    await expect(auth.connect(publicConn)).rejects.toThrow(/No client ID configured for connection "Contoso Dev"/);
    expect(mocks.publicConfigs).toHaveLength(0);
  });

  it('prefers the connection-level clientId override over the setting', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('setting-client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect({ ...publicConn, clientId: 'override-client-id' });

    expect(mocks.publicConfigs[0].auth.clientId).toBe('override-client-id');
  });

  it.each([
    ['public', 'login.microsoftonline.com'],
    ['usGov', 'login.microsoftonline.us'],
    ['china', 'login.partner.microsoftonline.cn'],
  ] as const)('builds the %s cloud authority from the tenant ID', async (cloud, host) => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect({ name: 'X', tenantId: 'my-tenant', cloud });

    expect(mocks.publicConfigs[0].auth.authority).toBe(`https://${host}/my-tenant`);
  });

  it('builds the ciamlogin.com authority for an External ID (CIAM) connection', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect({
      name: 'Contoso CIAM',
      tenantId: 'contoso-tenant-id',
      cloud: 'public',
      tenantKind: 'externalId',
      externalIdSubdomain: 'contoso',
    });

    expect(mocks.publicConfigs[0].auth.authority).toBe('https://contoso.ciamlogin.com/contoso-tenant-id/v2.0');
  });

  it('signs in silently when a cached account works, without prompting', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const cachedAccount = { username: 'me@contoso.com', name: 'Me' };
    mocks.cachedAccounts = [cachedAccount];
    mocks.acquireTokenSilent.mockResolvedValueOnce({ account: cachedAccount });

    const { auth } = makeAuth();
    const listener = vi.fn();
    auth.onDidChangeConnectionState(listener);

    await auth.connect(publicConn);

    expect(auth.isConnected('Contoso Dev')).toBe(true);
    expect(auth.getConnectedAccount('Contoso Dev')).toEqual({ username: 'me@contoso.com', name: 'Me' });
    expect(mocks.acquireTokenInteractive).not.toHaveBeenCalled();
    expect(mocks.acquireTokenByDeviceCode).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith('Contoso Dev');
  });

  it('falls back to interactive sign-in when the cached account cannot be used silently', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.cachedAccounts = [{ username: 'stale@contoso.com' }];
    mocks.acquireTokenSilent.mockRejectedValueOnce(new Error('token expired'));
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect(publicConn);

    expect(auth.isConnected('Contoso Dev')).toBe(true);
    expect(mocks.acquireTokenInteractive).toHaveBeenCalledTimes(1);
  });

  it('opens the browser via vscode.env.openExternal for the interactive flow', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect(publicConn);

    const request = mocks.acquireTokenInteractive.mock.calls[0][0] as {
      scopes: string[];
      openBrowser: (url: string) => Promise<void>;
    };
    expect(request.scopes).toEqual(['openid', 'profile', 'offline_access', 'https://graph.microsoft.com/.default']);

    await request.openBrowser('https://login.microsoftonline.com/authorize');
    expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
  });

  it('uses device code sign-in when authMode is deviceCode, prompting via a notification', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    vi.mocked(getAuthMode).mockReturnValue('deviceCode');
    mocks.acquireTokenByDeviceCode.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect(publicConn);

    expect(mocks.acquireTokenInteractive).not.toHaveBeenCalled();
    const request = mocks.acquireTokenByDeviceCode.mock.calls[0][0] as {
      deviceCodeCallback: (response: { verificationUri: string; userCode: string }) => void;
    };
    request.deviceCodeCallback({ verificationUri: 'https://microsoft.com/devicelogin', userCode: 'ABC123' });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('ABC123'));
  });

  it('throws when sign-in completes without an account', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: null });

    const { auth } = makeAuth();
    await expect(auth.connect(publicConn)).rejects.toThrow(/did not complete/);
    expect(auth.isConnected('Contoso Dev')).toBe(false);
  });

  it('reuses the same client for a connection instead of constructing a new one each time', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });
    mocks.acquireTokenSilent.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    await auth.connect(publicConn);
    mocks.cachedAccounts = [{ username: 'me@contoso.com' }];
    await auth.connect(publicConn);

    expect(mocks.publicConfigs).toHaveLength(1);
  });
});

describe('AuthService.connect — app-only (client secret)', () => {
  const secretConn: Connection = {
    name: 'Contoso App',
    tenantId: 'contoso-tenant',
    cloud: 'public',
    authMethod: 'clientSecret',
  };

  it('throws when no client secret is stored for the connection', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const { auth } = makeAuth();

    await expect(auth.connect(secretConn)).rejects.toThrow(/No client secret is stored for connection "Contoso App"/);
    expect(mocks.confidentialConfigs).toHaveLength(0);
  });

  it('builds a ConfidentialClientApplication with the stored secret and acquires an app-only token', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'shh-its-a-secret');

    const listener = vi.fn();
    auth.onDidChangeConnectionState(listener);
    await auth.connect(secretConn);

    expect(mocks.confidentialConfigs[0].auth.clientSecret).toBe('shh-its-a-secret');
    expect(mocks.confidentialConfigs[0].auth.authority).toBe('https://login.microsoftonline.com/contoso-tenant');
    expect(mocks.acquireTokenByClientCredential).toHaveBeenCalledWith({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    expect(auth.isConnected('Contoso App')).toBe(true);
    expect(listener).toHaveBeenCalledWith('Contoso App');
  });

  it('has no user account to report for an app-only connection', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'secret');

    await auth.connect(secretConn);

    expect(auth.getConnectedAccount('Contoso App')).toBeUndefined();
  });

  it('throws when the credential flow does not return an access token', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce(null);
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'secret');

    await expect(auth.connect(secretConn)).rejects.toThrow(/did not complete/);
    expect(auth.isConnected('Contoso App')).toBe(false);
  });
});

describe('AuthService.connect — app-only (client certificate)', () => {
  const sha1Thumbprint = 'a'.repeat(40);
  const sha256Thumbprint = 'b'.repeat(64);
  const certConn: Connection = {
    name: 'Contoso Cert',
    tenantId: 'contoso-tenant',
    cloud: 'public',
    authMethod: 'clientCertificate',
    certificateThumbprint: sha1Thumbprint,
  };

  it('throws when no certificate private key is stored for the connection', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const { auth } = makeAuth();

    await expect(auth.connect(certConn)).rejects.toThrow(
      /No certificate private key is stored for connection "Contoso Cert"/
    );
  });

  it('throws when the connection is missing its certificate thumbprint', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const { auth, credentials } = makeAuth();
    await credentials.setCertificateKey('Contoso Cert', 'pem-key');

    await expect(auth.connect({ ...certConn, certificateThumbprint: undefined })).rejects.toThrow(
      /missing its certificate thumbprint/
    );
  });

  it('uses the deprecated SHA-1 "thumbprint" field for a 40-character thumbprint', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setCertificateKey('Contoso Cert', 'pem-key');

    await auth.connect(certConn);

    expect(mocks.confidentialConfigs[0].auth.clientCertificate).toEqual({
      thumbprint: sha1Thumbprint,
      privateKey: 'pem-key',
    });
  });

  it('uses the non-deprecated "thumbprintSha256" field for a 64-character thumbprint', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setCertificateKey('Contoso Cert', 'pem-key');

    await auth.connect({ ...certConn, certificateThumbprint: sha256Thumbprint });

    expect(mocks.confidentialConfigs[0].auth.clientCertificate).toEqual({
      thumbprintSha256: sha256Thumbprint,
      privateKey: 'pem-key',
    });
  });

  it('marks the connection connected on success', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setCertificateKey('Contoso Cert', 'pem-key');

    await auth.connect(certConn);

    expect(auth.isConnected('Contoso Cert')).toBe(true);
  });
});

describe('AuthService.getGraphAccessToken', () => {
  it('throws when the connection was never connected at all', async () => {
    const { auth } = makeAuth();

    await expect(auth.getGraphAccessToken(publicConn)).rejects.toThrow(/Not connected to "Contoso Dev"/);
  });

  it('throws when a delegated connect attempt left a client cached but no account (sign-in never completed)', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: null });
    const { auth } = makeAuth();
    await expect(auth.connect(publicConn)).rejects.toThrow(/did not complete/);

    await expect(auth.getGraphAccessToken(publicConn)).rejects.toThrow(/Not connected to "Contoso Dev"/);
  });

  it('acquires a delegated token silently from the connected account', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });
    mocks.acquireTokenSilent.mockResolvedValueOnce({ accessToken: 'graph-token' });
    const { auth } = makeAuth();
    await auth.connect(publicConn);

    const token = await auth.getGraphAccessToken(publicConn);

    expect(token).toBe('graph-token');
    expect(mocks.acquireTokenSilent).toHaveBeenCalledWith({
      account: { username: 'me@contoso.com' },
      scopes: ['https://graph.microsoft.com/.default'],
    });
  });

  it('throws when the delegated silent acquisition does not return an access token', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });
    mocks.acquireTokenSilent.mockResolvedValueOnce({ accessToken: undefined });
    const { auth } = makeAuth();
    await auth.connect(publicConn);

    await expect(auth.getGraphAccessToken(publicConn)).rejects.toThrow(/Could not acquire a Microsoft Graph access token/);
  });

  it('acquires an app-only token via the client-credentials grant', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const secretConn: Connection = {
      name: 'Contoso App',
      tenantId: 'contoso-tenant',
      cloud: 'public',
      authMethod: 'clientSecret',
    };
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'secret');
    await auth.connect(secretConn);
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-graph-token' });

    const token = await auth.getGraphAccessToken(secretConn);

    expect(token).toBe('app-graph-token');
    expect(mocks.acquireTokenByClientCredential).toHaveBeenCalledWith({
      scopes: ['https://graph.microsoft.com/.default'],
    });
  });

  it('throws when the app-only client-credentials grant does not return an access token', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    const secretConn: Connection = {
      name: 'Contoso App',
      tenantId: 'contoso-tenant',
      cloud: 'public',
      authMethod: 'clientSecret',
    };
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'secret');
    await auth.connect(secretConn);
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce(null);

    await expect(auth.getGraphAccessToken(secretConn)).rejects.toThrow(/Could not acquire a Microsoft Graph access token/);
  });
});

describe('AuthService.disconnect', () => {
  it('removes the account from the token cache and clears the cached token secret', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });
    const { auth, secrets } = makeAuth();
    await auth.connect(publicConn);

    const listener = vi.fn();
    auth.onDidChangeConnectionState(listener);
    await auth.disconnect('Contoso Dev');

    expect(mocks.removeAccount).toHaveBeenCalledWith({ username: 'me@contoso.com' });
    expect(secrets.delete).toHaveBeenCalledWith('entra.tokenCache.Contoso Dev');
    expect(auth.isConnected('Contoso Dev')).toBe(false);
    expect(listener).toHaveBeenCalledWith('Contoso Dev');
  });

  it('is safe to call for a connection that was never connected', async () => {
    const { auth, secrets } = makeAuth();

    await auth.disconnect('Never Connected');

    expect(mocks.removeAccount).not.toHaveBeenCalled();
    expect(secrets.delete).toHaveBeenCalledWith('entra.tokenCache.Never Connected');
  });

  it('clears app-only connected state without touching the stored credential', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });
    const secretConn: Connection = {
      name: 'Contoso App',
      tenantId: 'contoso-tenant',
      cloud: 'public',
      authMethod: 'clientSecret',
    };
    const { auth, credentials } = makeAuth();
    await credentials.setClientSecret('Contoso App', 'secret');
    await auth.connect(secretConn);

    await auth.disconnect('Contoso App');

    expect(auth.isConnected('Contoso App')).toBe(false);
    // Disconnect ends the session, not the stored credential — reconnecting shouldn't require
    // re-entering the secret.
    expect(await credentials.getClientSecret('Contoso App')).toBe('secret');
  });

  it('disconnectAll disconnects every currently connected connection, delegated and app-only alike', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'a@contoso.com' } });
    mocks.acquireTokenByClientCredential.mockResolvedValueOnce({ accessToken: 'app-token' });

    const { auth, credentials } = makeAuth();
    await auth.connect({ name: 'A', tenantId: 't1', cloud: 'public' });
    await credentials.setClientSecret('B', 'secret');
    await auth.connect({ name: 'B', tenantId: 't2', cloud: 'public', authMethod: 'clientSecret' });

    await auth.disconnectAll();

    expect(auth.isConnected('A')).toBe(false);
    expect(auth.isConnected('B')).toBe(false);
  });
});

describe('AuthService.dispose', () => {
  it('stops connection-state listeners from firing afterwards', async () => {
    vi.mocked(getDefaultClientId).mockReturnValue('client-id');
    mocks.acquireTokenInteractive.mockResolvedValueOnce({ account: { username: 'me@contoso.com' } });

    const { auth } = makeAuth();
    const listener = vi.fn();
    auth.onDidChangeConnectionState(listener);

    auth.dispose();
    await auth.connect(publicConn);

    expect(listener).not.toHaveBeenCalled();
  });
});
