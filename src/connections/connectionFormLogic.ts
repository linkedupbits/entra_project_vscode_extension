import { Connection, Cloud, TenantKind, AuthMethod } from './types';

export interface ConnectionFormInput {
  name: string;
  tenantId: string;
  cloud: Cloud;
  clientId: string;
  tenantKind: TenantKind;
  externalIdSubdomain: string;
  authMethod: AuthMethod;
  /** Blank means "no new value entered" — see ExistingCredentialState. */
  clientSecret: string;
  certificateThumbprint: string;
  /** PEM-encoded private key. Blank means "no new value entered" — see ExistingCredentialState. */
  certificateKey: string;
}

/**
 * Whether this connection (when editing) already has a credential stored in SecretStorage, so
 * resolveSubmit knows a blank secret/key field means "keep the existing one" rather than
 * "missing" — a stored secret is never redisplayed in the form, so "blank" is ambiguous without
 * this. Both false when adding a new connection.
 */
export interface ExistingCredentialState {
  hasClientSecret: boolean;
  hasCertificateKey: boolean;
}

export type SubmitResolution =
  | { kind: 'clash'; name: string }
  | { kind: 'invalidClientId' }
  | { kind: 'missingExternalIdSubdomain' }
  | { kind: 'missingClientSecret' }
  | { kind: 'missingCertificateThumbprint' }
  | { kind: 'invalidCertificateThumbprint' }
  | { kind: 'missingCertificateKey' }
  | { kind: 'ok'; connection: Connection; clientSecret?: string; certificateKey?: string };

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A certificate's thumbprint is a SHA-1 (40 hex chars) or SHA-256 (64 hex chars) hash. MSAL-node
// accepts either — see authService.ts's buildClientCertificateConfig, which picks the right
// config field based on which length this is.
const THUMBPRINT_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * The Application (client) ID override must be the App Registration's Application (client) ID
 * — a GUID — not the Object ID of its Enterprise Application/Service Principal (also a GUID,
 * but a different one; see UC012). Checking the *shape* is the one thing worth validating this
 * early: it can't catch someone pasting the wrong-but-still-a-GUID identifier, but it does catch
 * the far more common slip of pasting a display name, an app name, or a partial/truncated value.
 */
export function isValidGuid(value: string): boolean {
  return GUID_PATTERN.test(value);
}

/** Strips the colons/spaces a thumbprint is often copied with (e.g. "AB:CD:...") before validating/storing it. */
export function normalizeThumbprint(value: string): string {
  return value.replace(/[\s:]/g, '');
}

export function isValidThumbprint(value: string): boolean {
  return THUMBPRINT_PATTERN.test(value);
}

/**
 * The UC012 A1 (name-already-in-use), A4 (invalid Application (client) ID), A5 (missing External
 * ID subdomain), and A6 (app-only credential validation) decisions, isolated from the
 * webview/store/SecretStorage side effects that surround them so they can be unit tested
 * directly. Trims free-text input and drops an empty client ID override rather than storing
 * `clientId: ""`.
 *
 * For an External ID (CIAM) tenant, `cloud` is always stored as 'public' regardless of what the
 * caller passes — External ID has no sovereign-cloud equivalent of `usGov`/`china`, and its login
 * endpoint (`<subdomain>.ciamlogin.com`) isn't selected via the Cloud field at all (see UC012).
 *
 * `clientSecret`/`certificateKey` are only present on the 'ok' result when the caller actually
 * provided a new value — the connection object itself never carries them (they belong in
 * SecretStorage, via CredentialStore, not connections.yaml).
 */
export function resolveSubmit(
  existing: readonly Connection[],
  editingName: string | undefined,
  input: ConnectionFormInput,
  existingCredentials: ExistingCredentialState = { hasClientSecret: false, hasCertificateKey: false }
): SubmitResolution {
  const name = input.name.trim();
  const tenantId = input.tenantId.trim();
  const clientId = input.clientId.trim();
  const externalIdSubdomain = input.externalIdSubdomain.trim();
  const clientSecret = input.clientSecret.trim();
  const thumbprint = normalizeThumbprint(input.certificateThumbprint.trim());
  const certificateKey = input.certificateKey.trim();

  const clash = existing.find(
    (c) => c.name.toLowerCase() === name.toLowerCase() && c.name !== editingName
  );
  if (clash) {
    return { kind: 'clash', name };
  }

  if (clientId && !isValidGuid(clientId)) {
    return { kind: 'invalidClientId' };
  }

  if (input.tenantKind === 'externalId' && !externalIdSubdomain) {
    return { kind: 'missingExternalIdSubdomain' };
  }

  if (input.authMethod === 'clientSecret') {
    if (!clientSecret && !existingCredentials.hasClientSecret) {
      return { kind: 'missingClientSecret' };
    }
  } else if (input.authMethod === 'clientCertificate') {
    if (!thumbprint) {
      return { kind: 'missingCertificateThumbprint' };
    }
    if (!isValidThumbprint(thumbprint)) {
      return { kind: 'invalidCertificateThumbprint' };
    }
    if (!certificateKey && !existingCredentials.hasCertificateKey) {
      return { kind: 'missingCertificateKey' };
    }
  }

  return {
    kind: 'ok',
    connection: {
      name,
      tenantId,
      cloud: input.tenantKind === 'externalId' ? 'public' : input.cloud,
      tenantKind: input.tenantKind,
      authMethod: input.authMethod,
      ...(clientId ? { clientId } : {}),
      ...(input.tenantKind === 'externalId' ? { externalIdSubdomain } : {}),
      ...(input.authMethod === 'clientCertificate' ? { certificateThumbprint: thumbprint } : {}),
    },
    ...(input.authMethod === 'clientSecret' && clientSecret ? { clientSecret } : {}),
    ...(input.authMethod === 'clientCertificate' && certificateKey ? { certificateKey } : {}),
  };
}

/**
 * UC012 A3 — a live session's cached authority/identity can't change out from under it, so
 * editing any of these fields on a connected connection means it needs to reconnect. A new
 * client secret/certificate key being provided is handled separately by the caller (it isn't
 * part of the Connection object this function compares), since providing one always means
 * reconnecting is necessary regardless of whether anything here also changed.
 */
export function authorityOrIdentityChanged(original: Connection, updated: Connection): boolean {
  return (
    updated.name !== original.name ||
    updated.tenantId !== original.tenantId ||
    updated.cloud !== original.cloud ||
    (updated.tenantKind ?? 'workforce') !== (original.tenantKind ?? 'workforce') ||
    updated.externalIdSubdomain !== original.externalIdSubdomain ||
    (updated.authMethod ?? 'delegated') !== (original.authMethod ?? 'delegated') ||
    updated.certificateThumbprint !== original.certificateThumbprint
  );
}

export function titleFor(editing: Connection | undefined): string {
  return editing ? `Edit Connection: ${editing.name}` : 'Add Connection';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isCloudSelected(current: Cloud | undefined, option: Cloud): boolean {
  return (current ?? 'public') === option;
}

export function isTenantKindSelected(current: TenantKind | undefined, option: TenantKind): boolean {
  return (current ?? 'workforce') === option;
}

export function isAuthMethodSelected(current: AuthMethod | undefined, option: AuthMethod): boolean {
  return (current ?? 'delegated') === option;
}
