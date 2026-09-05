import * as vscode from 'vscode';
import * as msal from '@azure/msal-node';
import { Connection, Cloud } from '../connections/types';
import { getAuthMode, getDefaultClientId } from '../config';
import { SecretStorageCachePlugin, tokenCacheKey } from './secretStorageCachePlugin';
import { CredentialStore } from './credentialStore';

const CLOUD_AUTHORITY_HOST: Record<Cloud, string> = {
  public: 'login.microsoftonline.com',
  usGov: 'login.microsoftonline.us',
  china: 'login.partner.microsoftonline.cn',
};

const GRAPH_RESOURCE: Record<Cloud, string> = {
  public: 'https://graph.microsoft.com/.default',
  usGov: 'https://graph.microsoft.us/.default',
  china: 'https://microsoftgraph.chinacloudapi.cn/.default',
};

export interface ConnectedAccount {
  username: string;
  name?: string;
}

/**
 * Entra External ID (CIAM) tenants sign in through their own subdomain-based endpoint, in the
 * form `https://<subdomain>.ciamlogin.com/<tenantId>/v2.0`, rather than the regular
 * `login.microsoftonline.com`-family hosts a Workforce tenant uses (see UC010/UC012).
 * connectionFormLogic.ts's resolveSubmit() guarantees `cloud` is always 'public' for an
 * externalId connection, so GRAPH_RESOURCE.public is always the right scope either way.
 */
function buildAuthority(connection: Connection): string {
  if (connection.tenantKind === 'externalId') {
    return `https://${connection.externalIdSubdomain}.ciamlogin.com/${connection.tenantId}/v2.0`;
  }
  return `https://${CLOUD_AUTHORITY_HOST[connection.cloud]}/${connection.tenantId}`;
}

/**
 * MSAL's `clientCertificate.thumbprint` (SHA-1) is deprecated in favor of `thumbprintSha256`,
 * kept only for older ADFS back-compat — but Entra's portal has long shown SHA-1 thumbprints, so
 * both are accepted here (see connectionFormLogic.ts's isValidThumbprint) and routed to whichever
 * config field actually matches the length of what the user provided.
 */
function buildClientCertificateConfig(thumbprint: string, privateKey: string): NonNullable<msal.NodeAuthOptions['clientCertificate']> {
  return thumbprint.length === 64 ? { thumbprintSha256: thumbprint, privateKey } : { thumbprint, privateKey };
}

/**
 * Implements UC010 (Authenticate to Entra, both the delegated user flow and the app-only client
 * credentials flow) and UC011 (Disconnect). One msal-node client per connection — a
 * PublicClientApplication for 'delegated', a ConfidentialClientApplication for 'clientSecret'/
 * 'clientCertificate' — each with its own SecretStorage-backed token cache (see
 * secretStorageCachePlugin.ts) — never written to a project file.
 */
export class AuthService implements vscode.Disposable {
  private readonly clients = new Map<string, msal.PublicClientApplication | msal.ConfidentialClientApplication>();
  private readonly accounts = new Map<string, msal.AccountInfo>();
  private readonly appOnlyConnected = new Set<string>();
  private readonly _onDidChangeConnectionState = new vscode.EventEmitter<string>();
  readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly credentials: CredentialStore
  ) {}

  isConnected(connectionName: string): boolean {
    return this.accounts.has(connectionName) || this.appOnlyConnected.has(connectionName);
  }

  /** Only meaningful for a 'delegated' connection — app-only auth has no user account. */
  getConnectedAccount(connectionName: string): ConnectedAccount | undefined {
    const account = this.accounts.get(connectionName);
    return account ? { username: account.username, name: account.name } : undefined;
  }

  /** UC010: delegated main flow (plus A1 device code, A2 silent re-auth) or the app-only client-credentials flow. */
  async connect(connection: Connection): Promise<void> {
    const clientId = connection.clientId?.trim() || getDefaultClientId();
    if (!clientId) {
      throw new Error(
        `No client ID configured for connection "${connection.name}". Set the "entra.clientId" ` +
          'setting, or provide a client ID override when adding/editing this connection.'
      );
    }

    const authMethod = connection.authMethod ?? 'delegated';
    if (authMethod === 'delegated') {
      await this.connectDelegated(connection, clientId);
    } else {
      await this.connectAppOnly(connection, authMethod, clientId);
    }
  }

  private async connectDelegated(connection: Connection, clientId: string): Promise<void> {
    const client = this.getOrCreateClient(connection, clientId) as msal.PublicClientApplication;
    const scopes = ['openid', 'profile', 'offline_access', GRAPH_RESOURCE[connection.cloud]];

    // A2 — silent re-authentication: try a cached account for this connection before prompting.
    const cachedAccounts = await client.getTokenCache().getAllAccounts();
    if (cachedAccounts.length > 0) {
      try {
        const silentResult = await client.acquireTokenSilent({ account: cachedAccounts[0], scopes });
        if (silentResult.account) {
          this.accounts.set(connection.name, silentResult.account);
          this._onDidChangeConnectionState.fire(connection.name);
          return;
        }
      } catch {
        // Cached account can't be used silently (expired/revoked) — fall through below.
      }
    }

    const authMode = getAuthMode();
    const result =
      authMode === 'deviceCode'
        ? await client.acquireTokenByDeviceCode({
            scopes,
            deviceCodeCallback: (response) => {
              void vscode.window.showInformationMessage(
                `Entra sign-in: open ${response.verificationUri} and enter code ${response.userCode}`
              );
            },
          })
        : await client.acquireTokenInteractive({
            scopes,
            openBrowser: async (url) => {
              await vscode.env.openExternal(vscode.Uri.parse(url));
            },
          });

    if (!result?.account) {
      throw new Error(`Sign-in for connection "${connection.name}" did not complete.`);
    }
    this.accounts.set(connection.name, result.account);
    this._onDidChangeConnectionState.fire(connection.name);
  }

  private async connectAppOnly(
    connection: Connection,
    authMethod: 'clientSecret' | 'clientCertificate',
    clientId: string
  ): Promise<void> {
    const credential =
      authMethod === 'clientSecret'
        ? await this.credentials.getClientSecret(connection.name)
        : await this.credentials.getCertificateKey(connection.name);
    if (!credential) {
      throw new Error(
        `No ${authMethod === 'clientSecret' ? 'client secret' : 'certificate private key'} is stored for ` +
          `connection "${connection.name}". Edit the connection to provide one.`
      );
    }
    if (authMethod === 'clientCertificate' && !connection.certificateThumbprint) {
      throw new Error(`Connection "${connection.name}" is missing its certificate thumbprint.`);
    }

    const client = this.getOrCreateClient(connection, clientId, credential) as msal.ConfidentialClientApplication;
    const result = await client.acquireTokenByClientCredential({ scopes: [GRAPH_RESOURCE[connection.cloud]] });
    if (!result?.accessToken) {
      throw new Error(`Sign-in for connection "${connection.name}" did not complete.`);
    }
    this.appOnlyConnected.add(connection.name);
    this._onDidChangeConnectionState.fire(connection.name);
  }

  /** UC011 main flow. */
  async disconnect(connectionName: string): Promise<void> {
    const client = this.clients.get(connectionName);
    const account = this.accounts.get(connectionName);
    if (client instanceof msal.PublicClientApplication && account) {
      await client.getTokenCache().removeAccount(account);
    }
    this.accounts.delete(connectionName);
    this.appOnlyConnected.delete(connectionName);
    this.clients.delete(connectionName);
    await this.secrets.delete(tokenCacheKey(connectionName));
    this._onDidChangeConnectionState.fire(connectionName);
  }

  /** UC011 A1 — disconnect all. */
  async disconnectAll(): Promise<void> {
    for (const name of [...this.accounts.keys(), ...this.appOnlyConnected.keys()]) {
      await this.disconnect(name);
    }
  }

  private getOrCreateClient(
    connection: Connection,
    clientId: string,
    credential?: string
  ): msal.PublicClientApplication | msal.ConfidentialClientApplication {
    const existing = this.clients.get(connection.name);
    if (existing) {
      return existing;
    }

    const authority = buildAuthority(connection);
    const cache = { cachePlugin: new SecretStorageCachePlugin(this.secrets, tokenCacheKey(connection.name)) };
    const authMethod = connection.authMethod ?? 'delegated';

    let client: msal.PublicClientApplication | msal.ConfidentialClientApplication;
    if (authMethod === 'clientSecret') {
      client = new msal.ConfidentialClientApplication({
        auth: { clientId, authority, clientSecret: credential },
        cache,
      });
    } else if (authMethod === 'clientCertificate') {
      client = new msal.ConfidentialClientApplication({
        auth: {
          clientId,
          authority,
          clientCertificate: buildClientCertificateConfig(connection.certificateThumbprint ?? '', credential ?? ''),
        },
        cache,
      });
    } else {
      client = new msal.PublicClientApplication({ auth: { clientId, authority }, cache });
    }
    this.clients.set(connection.name, client);
    return client;
  }

  dispose(): void {
    this._onDidChangeConnectionState.dispose();
  }
}
