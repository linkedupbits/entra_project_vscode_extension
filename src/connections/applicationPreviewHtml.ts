import { RequiredPermission, FederatedCredentialEntry } from '../applications/types';
import { ApplicationPreviewData } from './tenantApplicationPreview';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function listOrNone(items: readonly string[]): string {
  if (items.length === 0) {
    return '<div class="empty">None</div>';
  }
  return '<ul>' + items.map((item) => `<li>${escapeHtml(item)}</li>`).join('') + '</ul>';
}

function permissionsListOrNone(permissions: readonly RequiredPermission[]): string {
  if (permissions.length === 0) {
    return '<div class="empty">None</div>';
  }
  return (
    '<ul>' +
    permissions
      .map(
        (p) => `<li><code>${escapeHtml(p.resourceAppId)}</code> — <code>${escapeHtml(p.id)}</code> (${escapeHtml(p.type)})</li>`
      )
      .join('') +
    '</ul>'
  );
}

function federatedCredentialsListOrNone(entries: readonly FederatedCredentialEntry[]): string {
  if (entries.length === 0) {
    return '<div class="empty">None</div>';
  }
  return entries
    .map(
      (entry) => `
    <div class="fedcred-card">
      <div><strong>${escapeHtml(entry.name || '(unnamed)')}</strong></div>
      <div>Issuer: ${escapeHtml(entry.issuer)}</div>
      <div>Subject: ${escapeHtml(entry.subject)}</div>
      <div>Audiences: ${entry.audiences.length > 0 ? escapeHtml(entry.audiences.join(', ')) : '—'}</div>
      ${entry.description ? `<div>Description: ${escapeHtml(entry.description)}</div>` : ''}
    </div>`
    )
    .join('');
}

function errorBlock(message: string): string {
  return `<div class="error visible">${escapeHtml(message)}</div>`;
}

/**
 * UC034 — the structured, read-only body shown inside ArtifactViewerPanel for an application
 * preview, deliberately mirroring UC042's local structured editor's field layout (Application /
 * Federated Credentials / Service Principal) so a tenant application and a local application
 * definition look familiar side by side — minus any inputs, add/remove controls, or a Save
 * action, since this is a viewer, not an editor (UC032's read-only-by-construction requirement).
 * A section whose fetch failed shows its own error instead of blanking the whole preview.
 */
export function buildApplicationPreviewHtml(data: ApplicationPreviewData): string {
  const applicationSection =
    data.application.kind === 'error'
      ? errorBlock(data.application.message)
      : `
    <label>Display name</label>
    <div class="value">${escapeHtml(data.application.value.displayName || '(none)')}</div>
    <label>Sign-in audience</label>
    <div class="value">${escapeHtml(data.application.value.signInAudience)}</div>
    <h3>Redirect URIs</h3>
    ${listOrNone(data.application.value.redirectUris)}
    <h3>Required permissions</h3>
    ${permissionsListOrNone(data.application.value.requiredPermissions)}`;

  const federatedCredentialsSection =
    data.federatedCredentials.kind === 'error'
      ? errorBlock(data.federatedCredentials.message)
      : federatedCredentialsListOrNone(data.federatedCredentials.value);

  const servicePrincipalSection =
    data.servicePrincipal.kind === 'error'
      ? errorBlock(data.servicePrincipal.message)
      : `
    <label>Application (client) ID</label>
    <div class="value">${escapeHtml(data.servicePrincipal.value.appId || '(none)')}</div>
    <label>App role assignment required</label>
    <div class="value">${data.servicePrincipal.value.appRoleAssignmentRequired ? 'Yes' : 'No'}</div>
    <h3>Tags</h3>
    ${listOrNone(data.servicePrincipal.value.tags)}`;

  return `
    <h2>Application (App Registration)</h2>
    ${applicationSection}

    <h2>Federated Credentials</h2>
    ${federatedCredentialsSection}

    <h2>Service Principal (Enterprise Application)</h2>
    ${servicePrincipalSection}
  `;
}
