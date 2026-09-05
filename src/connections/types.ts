export type Cloud = 'public' | 'usGov' | 'china';

export type TenantKind = 'workforce' | 'externalId';

/**
 * 'delegated' (default) signs in a user interactively/via device code. 'clientSecret' and
 * 'clientCertificate' are app-only client credentials flow, authenticating the Enterprise
 * Application itself with no user involved.
 */
export type AuthMethod = 'delegated' | 'clientSecret' | 'clientCertificate';

export interface Connection {
  name: string;
  tenantId: string;
  cloud: Cloud;
  clientId?: string;
  /** Absent means 'workforce', for backward compatibility with connections saved before this field existed. */
  tenantKind?: TenantKind;
  /**
   * The subdomain segment of an Entra External ID (CIAM) tenant's login endpoint
   * (`https://<externalIdSubdomain>.ciamlogin.com/<tenantId>/v2.0`). Only meaningful, and only
   * ever set, when tenantKind is 'externalId'.
   */
  externalIdSubdomain?: string;
  /** Absent means 'delegated', for backward compatibility with connections saved before this field existed. */
  authMethod?: AuthMethod;
  /**
   * The certificate's thumbprint (SHA-1, 40 hex chars, or SHA-256, 64 hex chars — MSAL accepts
   * either). Non-secret — safe to store here. Only meaningful, and only ever set, when
   * authMethod is 'clientCertificate'. The matching private key is never stored here; it lives in
   * VS Code SecretStorage via CredentialStore, alongside the client secret for 'clientSecret'
   * connections — neither is ever written to connections.yaml.
   */
  certificateThumbprint?: string;
}
