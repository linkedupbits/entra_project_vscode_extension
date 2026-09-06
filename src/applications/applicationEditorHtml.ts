import * as crypto from 'crypto';
import {
  ApplicationFiles,
  AppConfig,
  ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS,
  RequiredPermission,
  Oauth2PermissionScopeEntry,
  FederatedCredentialEntry,
  overridesOnly,
} from './types';
import { MICROSOFT_GRAPH_APP_ID, parseResourceAppId, buildDependencyReference } from './resourceAppIdReference';
import { parseEnvironmentVariableIdName } from './oauth2ScopeIdReference';
import { PermissionOption } from './permissionIdOptions';

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function selectedAttr(current: string, option: string): string {
  return current === option ? 'selected' : '';
}

function variableRowsHtml(appConfig: AppConfig): string {
  return Object.entries(appConfig.Variables)
    .map(
      ([key, value]) => `
    <div class="row variable-row">
      <input type="text" class="var-key" placeholder="Key" value="${escapeHtml(key)}" />
      <input type="text" class="var-value" placeholder="Value" value="${escapeHtml(value)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
    )
    .join('');
}

/** The line shown in an environment's `<summary>` while its card is collapsed — see environmentRowsHtml. */
function envSummaryLabel(name: string, environmentCode: string): string {
  const text = name || '(unnamed)';
  return environmentCode ? `${text} — ${environmentCode}` : text;
}

function envVariableRowsHtml(variables: Record<string, string>): string {
  return Object.entries(variables)
    .map(
      ([key, value]) => `
      <div class="row env-var-row">
        <input type="text" class="env-var-key" placeholder="Key" value="${escapeHtml(key)}" />
        <input type="text" class="env-var-value" placeholder="Value" value="${escapeHtml(value)}" />
        <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
      </div>`
    )
    .join('');
}

const REDIRECT_URI_VARIABLE_KEYS: readonly string[] = Object.values(ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS);

function asUriArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === 'string' && value.trim() !== '' ? [value] : [];
}

/** One environment card's redirect-URI list for a single category — see environmentRowsHtml. */
function envRedirectListHtml(kind: 'web' | 'publicClient' | 'spa', label: string, uris: readonly string[]): string {
  const rows = uris
    .map(
      (uri) => `
        <div class="row env-redirect-row">
          <input type="text" class="env-redirect-value" placeholder="https://example.com/signin-oidc" value="${escapeHtml(uri)}" />
          <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
        </div>`
    )
    .join('');
  return `
        <div class="env-redirect-subsection">
          <div class="env-vars-heading">${escapeHtml(label)}</div>
          <div class="env-redirect-rows" data-redirect-kind="${kind}">${rows}</div>
          <button type="button" class="add-row-btn add-env-redirect-btn" data-redirect-kind="${kind}">+ Add ${escapeHtml(label.replace(/ redirect URIs$/, ''))} redirect URI</button>
        </div>`;
}

/**
 * Each environment renders as a collapsible `<details>` card (collapsed by default when loaded,
 * expanded when newly added — the same treatment as the Exposed API scopes / Federated Credentials
 * cards, and the whole section is wrapped in its own collapsible box too). `<summary>` shows the
 * environment's `name` and `environment_code`, kept live by `refreshEnvironmentSummaries()` in this
 * file's webview script. The card body carries the four fixed fields plus this environment's *own*
 * Variables — `overridesOnly(env.Variables, appConfig.Variables)`, since the shared defaults are
 * edited once in the top-level Variables section and `EnvironmentEntry.Variables` in memory holds
 * the full merged set (see its doc comment). The three redirect-URI lists (Web / Public client /
 * SPA) are also stored in that same `Variables` map (as array values under
 * `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS`) but are edited through their own dedicated lists here,
 * so they're excluded from the generic key/value list above.
 */
function environmentRowsHtml(appConfig: AppConfig): string {
  return appConfig.Environments.map((env) => {
    const ownVariables: Record<string, string> = {};
    for (const [key, value] of Object.entries(overridesOnly(env.Variables, appConfig.Variables))) {
      if (!REDIRECT_URI_VARIABLE_KEYS.includes(key) && typeof value === 'string') {
        ownVariables[key] = value;
      }
    }
    const webRedirectUris = asUriArray(env.Variables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.web]);
    const publicClientRedirectUris = asUriArray(env.Variables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.publicClient]);
    const spaRedirectUris = asUriArray(env.Variables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.spa]);
    return `
    <details class="environment-card">
      <summary class="environment-summary">
        <span class="environment-summary-label">${escapeHtml(envSummaryLabel(env.name, env.environment_code))}</span>
        <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
      </summary>
      <div class="environment-body">
        <label>Name
          <input type="text" class="env-name" placeholder="e.g. Dev" value="${escapeHtml(env.name)}" />
        </label>
        <label>Publisher domain
          <input type="text" class="env-publisherDomain" value="${escapeHtml(env.publisherDomain)}" />
        </label>
        <label>Tenancy type
          <select class="env-tenancy_type">
            <option value="workforce" ${selectedAttr(env.tenancy_type, 'workforce')}>Workforce</option>
            <option value="ciam" ${selectedAttr(env.tenancy_type, 'ciam')}>CIAM</option>
          </select>
        </label>
        <label>Environment code
          <input type="text" class="env-environment_code" value="${escapeHtml(env.environment_code)}" />
        </label>
        <div class="env-redirect-group">
          <div class="env-vars-heading">Redirect URIs</div>
          <div class="hint">Applied to this environment's App Registration at deploy time. Stored as this environment's <code>web_redirectUris</code> / <code>publicClient_redirectURIs</code> / <code>spa_redirectURIs</code> variables.</div>
          ${envRedirectListHtml('web', 'Web redirect URIs', webRedirectUris)}
          ${envRedirectListHtml('publicClient', 'Public client redirect URIs', publicClientRedirectUris)}
          ${envRedirectListHtml('spa', 'SPA redirect URIs', spaRedirectUris)}
        </div>
        <div class="env-vars-subsection">
          <div class="env-vars-heading">Variables owned by this environment</div>
          <div class="hint">The shared Variables from the section above apply to every environment already — only add here what's specific to this one.</div>
          <div class="env-var-rows">${envVariableRowsHtml(ownVariables)}</div>
          <button type="button" class="add-row-btn add-env-var-btn">+ Add variable</button>
        </div>
      </div>
    </details>`;
  }).join('');
}

/**
 * Renders the AppName half of a Dependencies row as a `<select>` of sibling application folders
 * (see ApplicationsBranch.listApplicationNames), not free text — the user picks a project, not
 * types a name that may not exist (this was an explicit product decision, not a validation
 * shortcut). A currently-saved value that's since been renamed/deleted is still included as an
 * option so it isn't silently discarded the next time this form is saved.
 */
function dependencyAppOptionsHtml(appOptions: readonly string[], selected: string): string {
  const options = !selected || appOptions.includes(selected) ? appOptions : [selected, ...appOptions];
  const placeholder = `<option value="" ${selected ? '' : 'selected'}>Select an application…</option>`;
  const rest = options
    .map((name) => `<option value="${escapeHtml(name)}" ${selectedAttr(selected, name)}>${escapeHtml(name)}</option>`)
    .join('');
  return placeholder + rest;
}

function dependencyRowsHtml(appConfig: AppConfig, appOptions: readonly string[]): string {
  return Object.entries(appConfig.Dependencies)
    .map(
      ([key, dependency]) => `
    <div class="row dependency-row">
      <input type="text" class="dep-key" placeholder="Reference key (e.g. SampleAPIApp)" value="${escapeHtml(key)}" />
      <select class="dep-appName">${dependencyAppOptionsHtml(appOptions, dependency.AppName)}</select>
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
    )
    .join('');
}

function stringListRowsHtml(values: readonly string[], inputClass: string, placeholder: string): string {
  return values
    .map(
      (value) => `
    <div class="row ${inputClass}-row">
      <input type="text" class="${inputClass}-value" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
    )
    .join('');
}

/**
 * Renders the fixed "Microsoft Graph" option plus one option per current `AppConfig.yaml`
 * Dependencies reference key — see `resourceAppIdReference.ts` for why these are the only two
 * recognised shapes a Required Permission row's `resourceAppId` can take through this dropdown.
 */
function permissionResourceAppIdOptionsHtml(selected: string, dependencyKeys: readonly string[]): string {
  const graphOption = `<option value="${MICROSOFT_GRAPH_APP_ID}" ${selectedAttr(selected, MICROSOFT_GRAPH_APP_ID)}>Microsoft Graph</option>`;
  const dependencyOptions = dependencyKeys
    .map((key) => {
      const value = buildDependencyReference(key);
      return `<option value="${escapeHtml(value)}" ${selectedAttr(selected, value)}>${escapeHtml(key)}</option>`;
    })
    .join('');
  return graphOption + dependencyOptions;
}

/**
 * A Permission ID renders as a dropdown of that resource's known permissions when any are known for
 * the row's current `resourceAppId` (see `permissionIdOptions.ts` — Microsoft Graph's well-known
 * catalogue, or a Dependency's own exposed `oauth2PermissionScopes`), selecting the one it currently
 * matches (by ID); a value that doesn't match any of them is shown as plain text with the same
 * warning-icon convention `resourceAppId` itself uses — but a *blank* ID isn't treated as a warning,
 * since that's just an unfinished new row, not a stale/suspicious one. When no options are known at
 * all for this `resourceAppId` (an unrecognised resource, or a Dependency with nothing exposed),
 * it's always plain text, warning-free.
 */
function permissionIdFieldHtml(
  resourceAppId: string,
  permissionId: string,
  permissionOptionsByResourceAppId: Readonly<Record<string, readonly PermissionOption[]>>
): string {
  const options = permissionOptionsByResourceAppId[resourceAppId] ?? [];
  if (options.length === 0) {
    return `<input type="text" class="perm-id" placeholder="Permission ID" value="${escapeHtml(permissionId)}" />`;
  }
  const matched = options.some((option) => option.id === permissionId);
  if (permissionId && !matched) {
    return (
      `<input type="text" class="perm-id" placeholder="Permission ID" value="${escapeHtml(permissionId)}" />` +
      `<span class="warning-icon" role="img" aria-label="Warning" title="Not found among the known permissions for this resource — shown as raw text.">⚠</span>`
    );
  }
  const optionsHtml = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}" data-type="${option.type}" ${selectedAttr(permissionId, option.id)}>${escapeHtml(option.label)} (${option.type})</option>`
    )
    .join('');
  return `<select class="perm-id">${optionsHtml}</select>`;
}

/**
 * A row's `resourceAppId` renders as the dropdown above when it matches one of the two recognised
 * shapes, or — when it doesn't (a hand-edited file, a reference to a since-renamed/removed
 * dependency, or a raw third-party GUID this form doesn't model) — as plain text with a warning
 * icon instead, so the value is never silently discarded or misrepresented (see UC042).
 */
function requiredPermissionRowsHtml(
  rows: readonly RequiredPermission[],
  dependencyKeys: readonly string[],
  permissionOptionsByResourceAppId: Readonly<Record<string, readonly PermissionOption[]>>
): string {
  return rows
    .map((row) => {
      const choice = parseResourceAppId(row.resourceAppId, dependencyKeys);
      const resourceAppIdField =
        choice.kind === 'unrecognized'
          ? `<span class="perm-resourceAppId-wrap">
        <input type="text" class="perm-resourceAppId" placeholder="Resource App ID" value="${escapeHtml(row.resourceAppId)}" />
        <span class="warning-icon" role="img" aria-label="Warning" title="Not recognised as Microsoft Graph or one of this application's Dependencies — shown as raw text.">⚠</span>
      </span>`
          : `<select class="perm-resourceAppId">${permissionResourceAppIdOptionsHtml(row.resourceAppId, dependencyKeys)}</select>`;
      return `
    <div class="row permission-row">
      ${resourceAppIdField}
      <span class="perm-id-cell">${permissionIdFieldHtml(row.resourceAppId, row.id, permissionOptionsByResourceAppId)}</span>
      <select class="perm-type">
        <option value="Scope" ${selectedAttr(row.type, 'Scope')}>Scope (delegated)</option>
        <option value="Role" ${selectedAttr(row.type, 'Role')}>Role (application)</option>
      </select>
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`;
    })
    .join('');
}

/** The line shown in a scope's `<summary>` while its card is collapsed — see oauth2PermissionScopeRowsHtml. */
function oauth2ScopeSummaryLabel(value: string, idVariableName: string): string {
  const text = value || '(no value)';
  return idVariableName ? `${text} — ${idVariableName}` : text;
}

/**
 * Each scope renders as a collapsible `<details>` card (collapsed by default — no `open` attribute
 * — since a new application definition can expose many scopes and showing every field of every one
 * at once would dwarf the rest of the form) rather than a single-line row: unlike this section's
 * siblings, one scope carries eight fields, several of them long free-text descriptions, so a flat
 * row would either wrap unreadably or force horizontal scrolling. `<summary>` (always visible, even
 * collapsed) shows the scope's value and ID variable name so a specific scope can be found without
 * expanding every card — kept in sync as those two fields are edited by `refreshOauth2ScopeSummaries()`
 * in this file's webview script.
 *
 * `scope.id` is generated here (not left blank) if a loaded entry didn't already have one — e.g. a
 * hand-authored `Application.yaml.j2` that omitted it — so the row always has a stable fallback id
 * to submit from its first render onward, without normalizeApplicationFields() itself needing to
 * mutate/invent data on every parse (see Oauth2PermissionScopeEntry's doc comment on why the id
 * must stay stable once a scope has been deployed). That fallback is only ever used if the row's
 * "ID variable name" field (see oauth2ScopeIdReference.ts) is left blank — filling it in makes the
 * id a `{{ environment.Variables.<name> }}` reference instead, resolved once deploy tooling exists.
 */
function oauth2PermissionScopeRowsHtml(scopes: readonly Oauth2PermissionScopeEntry[]): string {
  return scopes
    .map((scope) => {
      const id = scope.id || crypto.randomUUID();
      const idVariableName = parseEnvironmentVariableIdName(scope.id) ?? '';
      return `
    <details class="oauth2-scope-card">
      <summary class="oauth2-scope-summary">
        <span class="oauth2-scope-summary-label">${escapeHtml(oauth2ScopeSummaryLabel(scope.value, idVariableName))}</span>
        <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
      </summary>
      <div class="oauth2-scope-body">
        <input type="hidden" class="oauth2-scope-id" value="${escapeHtml(id)}" />
        <label>Scope value
          <input type="text" class="oauth2-scope-value" placeholder="e.g. Files.Read" value="${escapeHtml(scope.value)}" />
        </label>
        <label>ID variable name
          <input type="text" class="oauth2-scope-idVariableName" placeholder="Optional, e.g. MyScopeId" value="${escapeHtml(idVariableName)}" title="If set, the scope's ID is written as {{ environment.Variables.<this> }} instead of a fixed GUID." />
        </label>
        <label>Type
          <select class="oauth2-scope-type">
            <option value="User" ${selectedAttr(scope.type, 'User')}>User (delegated)</option>
            <option value="Admin" ${selectedAttr(scope.type, 'Admin')}>Admin only</option>
          </select>
        </label>
        <label class="oauth2-scope-enabled-label">
          <input type="checkbox" class="oauth2-scope-isEnabled" ${scope.isEnabled ? 'checked' : ''} />
          Enabled
        </label>
        <label>Admin consent display name
          <input type="text" class="oauth2-scope-adminConsentDisplayName" value="${escapeHtml(scope.adminConsentDisplayName)}" />
        </label>
        <label>Admin consent description
          <input type="text" class="oauth2-scope-adminConsentDescription" value="${escapeHtml(scope.adminConsentDescription)}" />
        </label>
        <label>User consent display name
          <input type="text" class="oauth2-scope-userConsentDisplayName" value="${escapeHtml(scope.userConsentDisplayName)}" />
        </label>
        <label>User consent description
          <input type="text" class="oauth2-scope-userConsentDescription" value="${escapeHtml(scope.userConsentDescription)}" />
        </label>
      </div>
    </details>`;
    })
    .join('');
}

/** The line shown in a credential's `<summary>` while its card is collapsed — see federatedCredentialRowsHtml. */
function fedcredSummaryLabel(name: string, subject: string): string {
  const text = name || '(unnamed)';
  return subject ? `${text} — ${subject}` : text;
}

/**
 * Each credential renders as a collapsible `<details>` card, collapsed by default (a credential
 * loaded from disk) — a new one added via **+ Add federated credential** starts expanded instead —
 * the same treatment as the Exposed API scopes list above, for the same reason: several long
 * free-text fields per entry would otherwise wrap unreadably as a single-line row. `<summary>`
 * shows the credential's `Name` and `Subject` (its two most identifying fields), kept live by
 * `refreshFedCredSummaries()` in this file's webview script as either is edited.
 */
function federatedCredentialRowsHtml(entries: readonly FederatedCredentialEntry[]): string {
  return entries
    .map(
      (entry) => `
    <details class="fedcred-card">
      <summary class="fedcred-summary">
        <span class="fedcred-summary-label">${escapeHtml(fedcredSummaryLabel(entry.name, entry.subject))}</span>
        <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
      </summary>
      <div class="fedcred-body">
        <label>Name
          <input type="text" class="fedcred-name" value="${escapeHtml(entry.name)}" />
        </label>
        <label>Issuer
          <input type="text" class="fedcred-issuer" value="${escapeHtml(entry.issuer)}" />
        </label>
        <label>Subject
          <input type="text" class="fedcred-subject" value="${escapeHtml(entry.subject)}" />
        </label>
        <label>Audiences (comma-separated)
          <input type="text" class="fedcred-audiences" value="${escapeHtml(entry.audiences.join(', '))}" />
        </label>
        <label>Description
          <input type="text" class="fedcred-description" value="${escapeHtml(entry.description)}" />
        </label>
      </div>
    </details>`
    )
    .join('');
}

/**
 * UC042 — the structured form's HTML/CSS/client-side script. Thin webview glue (excluded from
 * coverage, same exemption `applicationFormPanel.ts` had before this was split out of
 * `applicationEditorProvider.ts`) — the actual decision logic it posts messages to/from lives in
 * `applicationFormLogic.ts` (validation) and `applicationEditorProvider.ts` (document lifecycle),
 * both of which are tested directly.
 */
export function getHtml(
  name: string,
  files: ApplicationFiles,
  dependencyAppOptions: readonly string[],
  permissionOptionsByResourceAppId: Readonly<Record<string, readonly PermissionOption[]>>
): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const { appConfig, application, federatedCredentials, servicePrincipal } = files;
  const dependencyAppOptionsJson = JSON.stringify(dependencyAppOptions).replace(/</g, '\\u003c');
  const microsoftGraphAppIdJson = JSON.stringify(MICROSOFT_GRAPH_APP_ID);
  const permissionOptionsByResourceAppIdJson = JSON.stringify(permissionOptionsByResourceAppId).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Application: ${escapeHtml(name)}</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 24px;
    max-width: 860px;
  }
  h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 4px; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 28px 0 4px; }
  h3 { font-size: 0.95em; font-weight: 600; margin: 20px 0 4px; color: var(--vscode-descriptionForeground); }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 8px; }
  label { display: block; margin-top: 16px; margin-bottom: 4px; font-weight: 600; }
  .checkbox-label { display: flex; align-items: center; gap: 6px; font-weight: normal; margin-top: 16px; }
  .checkbox-label input { width: auto; }
  input[type="text"], select, textarea {
    box-sizing: border-box;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-size: 1em;
    font-family: inherit;
  }
  input[type="text"], select { width: 100%; }
  textarea {
    width: 100%;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
    min-height: 140px;
    resize: vertical;
  }
  input:focus, select:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .generated-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 14px; }
  .generated-tag {
    display: inline-block;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 2px;
    padding: 2px 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
  }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .row input, .row select { flex: 1; min-width: 0; }
  .oauth2-scope-card, .fedcred-card, .environment-card {
    display: block;
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 3px;
    margin-bottom: 8px;
  }
  .oauth2-scope-summary, .fedcred-summary, .environment-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
  }
  .oauth2-scope-summary-label, .fedcred-summary-label, .environment-summary-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
  }
  .oauth2-scope-body, .fedcred-body, .environment-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 16px;
    padding: 4px 12px 14px;
    border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .oauth2-scope-body label, .fedcred-body label, .environment-body label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    font-weight: 600;
    font-size: 0.85em;
  }
  .oauth2-scope-body label > input, .oauth2-scope-body label > select,
  .fedcred-body label > input,
  .environment-body label > input, .environment-body label > select {
    font-weight: normal;
    font-size: 1em;
  }
  .oauth2-scope-enabled-label {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--vscode-descriptionForeground);
  }
  .oauth2-scope-enabled-label input { width: auto; }
  .section-card { display: block; margin: 28px 0 4px; }
  .section-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 1.05em;
    font-weight: 600;
    padding: 4px 0 6px;
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  }
  .section-count { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 0.85em; }
  .section-body { padding-top: 10px; }
  /* The native <summary> disclosure marker disappears once a summary is display:flex, so every
     collapsible summary draws its own chevron here — pointing right when closed, down when open. */
  .section-summary, .oauth2-scope-summary, .fedcred-summary, .environment-summary { list-style: none; }
  .section-summary::-webkit-details-marker, .oauth2-scope-summary::-webkit-details-marker,
  .fedcred-summary::-webkit-details-marker, .environment-summary::-webkit-details-marker { display: none; }
  .section-summary::before, .oauth2-scope-summary::before,
  .fedcred-summary::before, .environment-summary::before {
    content: "";
    flex: 0 0 auto;
    width: 0;
    height: 0;
    border: 4px solid transparent;
    border-left-color: currentColor;
    margin-right: 2px;
    transition: transform 0.12s ease;
  }
  details[open] > .section-summary::before, details[open] > .oauth2-scope-summary::before,
  details[open] > .fedcred-summary::before, details[open] > .environment-summary::before {
    transform: rotate(90deg);
  }
  .env-vars-subsection, .env-redirect-group { grid-column: 1 / -1; margin-top: 4px; }
  .env-vars-subsection > .env-vars-heading, .env-redirect-group > .env-vars-heading {
    font-weight: 600;
    font-size: 0.85em;
    margin-bottom: 4px;
  }
  .env-redirect-subsection { margin: 4px 0 8px; padding-left: 10px; border-left: 2px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
  .env-redirect-subsection > .env-vars-heading { font-size: 0.85em; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
  .perm-resourceAppId-wrap, .perm-id-cell { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .warning-icon {
    flex: 0 0 auto;
    color: var(--vscode-editorWarning-foreground, var(--vscode-problemsWarningIcon-foreground, orange));
    cursor: help;
  }
  .remove-row-btn {
    flex: 0 0 auto;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 4px 8px;
  }
  .remove-row-btn:hover { color: var(--vscode-errorForeground); }
  .add-row-btn {
    background: none;
    border: 1px dashed var(--vscode-widget-border, var(--vscode-panel-border));
    color: var(--vscode-textLink-foreground);
    border-radius: 2px;
    padding: 4px 10px;
    cursor: pointer;
    margin-top: 4px;
  }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); margin: 24px 0 0; }
  .error {
    color: var(--vscode-errorForeground);
    font-size: 0.9em;
    margin-top: 4px;
    display: none;
  }
  .error.visible { display: block; }
  .actions { margin-top: 28px; display: flex; gap: 8px; }
  button.primary, button.secondary {
    padding: 6px 14px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    cursor: pointer;
    font-size: 1em;
    font-family: inherit;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <h1>Application: ${escapeHtml(name)}</h1>
  <div class="subtitle">Editing this application's four files as one structured view. Saving writes all four back to disk — comments and other hand-written formatting are not preserved (see UC042); review changes with <code>git diff</code> before committing. This tab shows VS Code's normal unsaved-changes indicator while you have edits pending.</div>

  <form id="form">
    <label for="applicationName">Application name</label>
    <input type="text" id="applicationName" value="${escapeHtml(appConfig.application_name)}" />
    <div class="error" id="applicationNameError">Enter an application name.</div>

    <label for="businessUnit">Business unit</label>
    <input type="text" id="businessUnit" value="${escapeHtml(appConfig.business_unit)}" />

    <details class="section-card" id="variablesSection">
      <summary class="section-summary"><span>Default variables</span><span class="section-count" id="variableCount">(${Object.keys(appConfig.Variables).length})</span></summary>
      <div class="section-body">
        <div class="hint">Default values shared across every environment below.</div>
        <div id="variableRows">${variableRowsHtml(appConfig)}</div>
        <button type="button" class="add-row-btn" id="addVariableBtn">+ Add variable</button>
        <div class="error" id="variablesError"></div>
      </div>
    </details>

    <details class="section-card" id="environmentsSection">
      <summary class="section-summary"><span>Environments</span><span class="section-count" id="environmentCount">(${appConfig.Environments.length})</span></summary>
      <div class="section-body">
        <div class="hint">One deployment target per card — collapsed by default, click a card to expand it.</div>
        <div id="environmentRows">${environmentRowsHtml(appConfig)}</div>
        <button type="button" class="add-row-btn" id="addEnvironmentBtn">+ Add environment</button>
        <div class="error" id="environmentsError"></div>
      </div>
    </details>

    <details class="section-card" id="dependenciesSection">
      <summary class="section-summary"><span>Dependencies</span><span class="section-count" id="dependencyCount">(${Object.keys(appConfig.Dependencies).length})</span></summary>
      <div class="section-body">
        <div class="hint">Other applications this one depends on for deploy sequencing. Reference one in a template as <code>{{ dependency_refs.&lt;Key&gt;.applicationId }}</code>, resolved once the referenced application has been deployed.</div>
        <div id="dependencyRows">${dependencyRowsHtml(appConfig, dependencyAppOptions)}</div>
        <button type="button" class="add-row-btn" id="addDependencyBtn">+ Add dependency</button>
        <div class="error" id="dependenciesError"></div>
      </div>
    </details>

    <hr />

    <details class="section-card" id="applicationSection">
      <summary class="section-summary"><span>Application (App Registration)</span></summary>
      <div class="section-body">
        <div class="hint">Application.yaml.j2 — mirrors the Graph JSON body for creating/updating the App Registration.</div>

        <label for="displayName">Display name</label>
        <input type="text" id="displayName" value="${escapeHtml(application.displayName)}" />

        <label for="signInAudience">Sign-in audience</label>
        <select id="signInAudience">
          <option value="AzureADMyOrg" ${selectedAttr(application.signInAudience, 'AzureADMyOrg')}>My organization only (AzureADMyOrg)</option>
          <option value="AzureADMultipleOrgs" ${selectedAttr(application.signInAudience, 'AzureADMultipleOrgs')}>Any organization (AzureADMultipleOrgs)</option>
          <option value="AzureADandPersonalMicrosoftAccount" ${selectedAttr(application.signInAudience, 'AzureADandPersonalMicrosoftAccount')}>Any organization and personal Microsoft accounts</option>
          <option value="PersonalMicrosoftAccount" ${selectedAttr(application.signInAudience, 'PersonalMicrosoftAccount')}>Personal Microsoft accounts only</option>
        </select>

        <div class="hint">Redirect URIs are defined per environment (in the Environments section above), not here. On save, the App Registration's <code>web</code> / <code>publicClient</code> / <code>spa</code> redirect blocks (and <code>web.redirectUriSettings</code>) are written automatically as Jinja2/Nunjucks loops that pull from those per-environment lists — not editable here.</div>

    <details class="section-card" id="permissionsSection">
      <summary class="section-summary"><span>Required permissions</span><span class="section-count" id="permissionCount">(${application.requiredPermissions.length})</span></summary>
      <div class="section-body">
        <div class="hint">One row per permission — rows sharing a Resource App ID are grouped together when saved. Resource App ID is either Microsoft Graph or one of this application's Dependencies (added above); a value that's neither (e.g. from a hand-edited file, or referencing a dependency since renamed or removed) is shown as plain text with a ⚠ warning instead.</div>
        <div id="permissionRows">${requiredPermissionRowsHtml(application.requiredPermissions, Object.keys(appConfig.Dependencies), permissionOptionsByResourceAppId)}</div>
        <button type="button" class="add-row-btn" id="addPermissionBtn">+ Add permission</button>
      </div>
    </details>

    <details class="section-card" id="oauth2ScopesSection">
      <summary class="section-summary"><span>Exposed API scopes (oauth2PermissionScopes)</span><span class="section-count" id="oauth2ScopeCount">(${application.oauth2PermissionScopes.length})</span></summary>
      <div class="section-body">
        <div class="hint">Delegated permission scopes this application exposes for other applications to request — Graph's <code>api.oauth2PermissionScopes</code>. Each scope's ID is generated automatically and kept stable across saves, so a previously deployed scope is updated in place rather than replaced — or give it an <strong>ID variable name</strong> to write the ID as <code>{{ environment.Variables.&lt;name&gt; }}</code> instead, resolved per environment once deploy tooling exists.</div>
        <div id="oauth2ScopeRows">${oauth2PermissionScopeRowsHtml(application.oauth2PermissionScopes)}</div>
        <button type="button" class="add-row-btn" id="addOauth2ScopeBtn">+ Add scope</button>
      </div>
    </details>
      </div>
    </details>

    <details class="section-card" id="fedcredSection">
      <summary class="section-summary"><span>Federated Credentials</span><span class="section-count" id="fedcredCount">(${federatedCredentials.length})</span></summary>
      <div class="section-body">
        <div class="hint">FederatedCredentials.yaml.j2 — one row per credential.</div>
        <div id="fedcredRows">${federatedCredentialRowsHtml(federatedCredentials)}</div>
        <button type="button" class="add-row-btn" id="addFedCredBtn">+ Add federated credential</button>
      </div>
    </details>

    <details class="section-card" id="servicePrincipalSection">
      <summary class="section-summary"><span>Service Principal</span></summary>
      <div class="section-body">
        <div class="hint">ServicePrincipal.yaml.j2 — mirrors the Graph JSON body for the Enterprise Application. On save, a <code>replyUrls</code> key is written automatically as a Jinja2/Nunjucks loop that renders to an array of each environment's three redirect-URI variable lists combined — it is not editable here.</div>

        <label for="appId">Application (client) ID</label>
        <input type="text" id="appId" value="${escapeHtml(servicePrincipal.appId)}" />

        <label class="checkbox-label">
          <input type="checkbox" id="appRoleAssignmentRequired" ${servicePrincipal.appRoleAssignmentRequired ? 'checked' : ''} />
          Require app role assignment before users can sign in
        </label>

        <h3>Tags</h3>
        <div class="hint">Generated automatically at deploy time from the Application name and Business unit above (see UC042) — read-only preview, not saved by this form.</div>
        <div class="generated-tags" id="generatedTags">
          <span class="generated-tag" id="generatedTagAppName"></span>
          <span class="generated-tag" id="generatedTagEnvironment"></span>
          <span class="generated-tag" id="generatedTagName"></span>
          <span class="generated-tag" id="generatedTagBusinessUnit"></span>
        </div>
        <div class="hint">Additional custom tags:</div>
        <div id="tagRows">${stringListRowsHtml(servicePrincipal.tags, 'tag', 'Tag')}</div>
        <button type="button" class="add-row-btn" id="addTagBtn">+ Add tag</button>
        <div class="error" id="tagsError"></div>
      </div>
    </details>

    <div class="error" id="generalError"></div>

    <div class="actions">
      <button type="submit" class="primary">Save</button>
      <button type="button" class="secondary" id="cancelBtn">Discard unsaved changes</button>
    </div>
  </form>

<script nonce="${nonce}">
  (function () {
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('form');
    const applicationNameInput = document.getElementById('applicationName');
    const applicationNameError = document.getElementById('applicationNameError');
    const variableRows = document.getElementById('variableRows');
    const variablesError = document.getElementById('variablesError');
    const environmentRows = document.getElementById('environmentRows');
    const environmentsError = document.getElementById('environmentsError');
    const dependencyRows = document.getElementById('dependencyRows');
    const dependenciesError = document.getElementById('dependenciesError');
    const dependencyAppOptions = ${dependencyAppOptionsJson};
    const MICROSOFT_GRAPH_APP_ID = ${microsoftGraphAppIdJson};
    // A snapshot as of when this tab was last (re)rendered — see permissionIdOptions.ts for why a
    // dependency added in this same editing session won't have options here until reopened/reverted.
    const PERMISSION_OPTIONS_BY_RESOURCE_APP_ID = ${permissionOptionsByResourceAppIdJson};
    const permissionRows = document.getElementById('permissionRows');
    const oauth2ScopeRows = document.getElementById('oauth2ScopeRows');
    const fedcredRows = document.getElementById('fedcredRows');
    const tagRows = document.getElementById('tagRows');
    const tagsError = document.getElementById('tagsError');
    const generalError = document.getElementById('generalError');
    const businessUnitInput = document.getElementById('businessUnit');
    const generatedTagAppName = document.getElementById('generatedTagAppName');
    const generatedTagEnvironment = document.getElementById('generatedTagEnvironment');
    const generatedTagName = document.getElementById('generatedTagName');
    const generatedTagBusinessUnit = document.getElementById('generatedTagBusinessUnit');

    function updateGeneratedTags() {
      const appName = applicationNameInput.value;
      const businessUnit = businessUnitInput.value;
      generatedTagAppName.textContent = 'AppName:<Environment>_' + businessUnit + '_' + appName;
      generatedTagEnvironment.textContent = 'Environment:{{Environment}}';
      generatedTagName.textContent = appName;
      generatedTagBusinessUnit.textContent = 'BusinessUnit:' + businessUnit;
    }
    applicationNameInput.addEventListener('input', updateGeneratedTags);
    businessUnitInput.addEventListener('input', updateGeneratedTags);
    updateGeneratedTags();

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function onRemoveClick(row) {
      row.querySelector('.remove-row-btn').addEventListener('click', function (e) {
        // Some rows (the Exposed API scope cards) put this button inside a <summary>, where a
        // plain click would otherwise also toggle that row's collapsed/expanded state — harmless
        // to call on every other row type too, since a type="button" has no default action anyway.
        e.preventDefault();
        e.stopPropagation();
        row.remove();
        notifyEdit();
      });
    }

    function appendRow(container, className, html, tagName) {
      const row = document.createElement(tagName || 'div');
      row.className = className;
      row.innerHTML = html;
      container.appendChild(row);
      onRemoveClick(row);
      notifyEdit();
      return row;
    }

    function addVariableRow() {
      appendRow(
        variableRows,
        'row variable-row',
        '<input type="text" class="var-key" placeholder="Key" />' +
          '<input type="text" class="var-value" placeholder="Value" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addEnvironmentRow() {
      // Starts expanded (a loaded environment starts collapsed) — same reasoning as addOauth2ScopeRow.
      var row = appendRow(
        environmentRows,
        'environment-card',
        '<summary class="environment-summary">' +
          '<span class="environment-summary-label">(unnamed)</span>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>' +
          '</summary>' +
          '<div class="environment-body">' +
          '<label>Name<input type="text" class="env-name" placeholder="e.g. Dev" /></label>' +
          '<label>Publisher domain<input type="text" class="env-publisherDomain" /></label>' +
          '<label>Tenancy type<select class="env-tenancy_type">' +
          '<option value="workforce">Workforce</option><option value="ciam">CIAM</option>' +
          '</select></label>' +
          '<label>Environment code<input type="text" class="env-environment_code" /></label>' +
          '<div class="env-redirect-group">' +
          '<div class="env-vars-heading">Redirect URIs</div>' +
          '<div class="hint">Applied to this environment\\'s App Registration at deploy time. Stored as this environment\\'s web_redirectUris / publicClient_redirectURIs / spa_redirectURIs variables.</div>' +
          '<div class="env-redirect-subsection"><div class="env-vars-heading">Web redirect URIs</div>' +
          '<div class="env-redirect-rows" data-redirect-kind="web"></div>' +
          '<button type="button" class="add-row-btn add-env-redirect-btn" data-redirect-kind="web">+ Add Web redirect URI</button></div>' +
          '<div class="env-redirect-subsection"><div class="env-vars-heading">Public client redirect URIs</div>' +
          '<div class="env-redirect-rows" data-redirect-kind="publicClient"></div>' +
          '<button type="button" class="add-row-btn add-env-redirect-btn" data-redirect-kind="publicClient">+ Add Public client redirect URI</button></div>' +
          '<div class="env-redirect-subsection"><div class="env-vars-heading">SPA redirect URIs</div>' +
          '<div class="env-redirect-rows" data-redirect-kind="spa"></div>' +
          '<button type="button" class="add-row-btn add-env-redirect-btn" data-redirect-kind="spa">+ Add SPA redirect URI</button></div>' +
          '</div>' +
          '<div class="env-vars-subsection">' +
          '<div class="env-vars-heading">Variables owned by this environment</div>' +
          '<div class="hint">The shared Variables from the section above apply to every environment already — only add here what\\'s specific to this one.</div>' +
          '<div class="env-var-rows"></div>' +
          '<button type="button" class="add-row-btn add-env-var-btn">+ Add variable</button>' +
          '</div>' +
          '</div>',
        'details'
      );
      row.open = true;
    }

    function addEnvVariableRow(container) {
      appendRow(
        container,
        'row env-var-row',
        '<input type="text" class="env-var-key" placeholder="Key" />' +
          '<input type="text" class="env-var-value" placeholder="Value" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addDependencyRow() {
      const optionsHtml =
        '<option value="" selected>Select an application…</option>' +
        dependencyAppOptions
          .map(function (name) {
            return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
          })
          .join('');
      appendRow(
        dependencyRows,
        'row dependency-row',
        '<input type="text" class="dep-key" placeholder="Reference key (e.g. SampleAPIApp)" />' +
          '<select class="dep-appName">' +
          optionsHtml +
          '</select>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addEnvRedirectRow(container) {
      appendRow(
        container,
        'row env-redirect-row',
        '<input type="text" class="env-redirect-value" placeholder="https://example.com/signin-oidc" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    // Mirrors resourceAppIdReference.ts's buildDependencyReference() — duplicated here because
    // this script runs in the webview's own isolated JS context, which can't import that module.
    function buildDependencyReference(key) {
      return '{{ dependency_refs.' + key + '.applicationId }}';
    }

    function currentDependencyKeys() {
      return Array.from(document.querySelectorAll('.dep-key'))
        .map(function (input) {
          return input.value.trim();
        })
        .filter(function (key) {
          return key !== '';
        });
    }

    function permissionResourceAppIdOptionsHtml(selectedValue, dependencyKeys) {
      var html =
        '<option value="' +
        MICROSOFT_GRAPH_APP_ID +
        '"' +
        (selectedValue === MICROSOFT_GRAPH_APP_ID ? ' selected' : '') +
        '>Microsoft Graph</option>';
      dependencyKeys.forEach(function (key) {
        var value = buildDependencyReference(key);
        html +=
          '<option value="' +
          escapeHtml(value) +
          '"' +
          (selectedValue === value ? ' selected' : '') +
          '>' +
          escapeHtml(key) +
          '</option>';
      });
      return html;
    }

    // Keeps every Required Permission row's Resource App ID dropdown (not the plain-text fallback
    // rows — see requiredPermissionRowsHtml) in sync with the current Dependencies rows, so a
    // dependency added/renamed/removed during this same editing session is immediately selectable
    // without having to close and reopen the tab. Cheap enough over this form's realistic row
    // counts to just run on every edit (see notifyEdit) rather than wiring narrower triggers.
    function refreshPermissionResourceAppIdOptions() {
      var keys = currentDependencyKeys();
      document.querySelectorAll('.permission-row').forEach(function (row) {
        var select = row.querySelector('select.perm-resourceAppId');
        if (!select) {
          return; // the unrecognized-value fallback is a plain text input, not a select — leave it alone
        }
        var currentValue = select.value;
        select.innerHTML = permissionResourceAppIdOptionsHtml(currentValue, keys);
      });
    }

    // Mirrors applicationEditorHtml.ts's oauth2ScopeSummaryLabel() — duplicated here for the same
    // reason as the other server/client pairs in this script.
    function oauth2ScopeSummaryLabel(value, idVariableName) {
      var text = value || '(no value)';
      return idVariableName ? text + ' — ' + idVariableName : text;
    }

    // Keeps each Exposed API scope card's collapsed-state summary in sync with its own Scope
    // value/ID variable name fields, so a specific scope stays identifiable without expanding it.
    function refreshOauth2ScopeSummaries() {
      document.querySelectorAll('.oauth2-scope-card').forEach(function (card) {
        var value = card.querySelector('.oauth2-scope-value').value;
        var idVariableName = card.querySelector('.oauth2-scope-idVariableName').value;
        card.querySelector('.oauth2-scope-summary-label').textContent = oauth2ScopeSummaryLabel(value, idVariableName);
      });
    }

    // Mirrors applicationEditorHtml.ts's fedcredSummaryLabel() — duplicated here for the same
    // reason as the other server/client pairs in this script.
    function fedcredSummaryLabel(name, subject) {
      var text = name || '(unnamed)';
      return subject ? text + ' — ' + subject : text;
    }

    // Keeps each federated credential card's collapsed-state summary in sync with its own Name/
    // Subject fields, so a specific credential stays identifiable without expanding it.
    function refreshFedCredSummaries() {
      document.querySelectorAll('.fedcred-card').forEach(function (card) {
        var name = card.querySelector('.fedcred-name').value;
        var subject = card.querySelector('.fedcred-subject').value;
        card.querySelector('.fedcred-summary-label').textContent = fedcredSummaryLabel(name, subject);
      });
    }

    // Mirrors applicationEditorHtml.ts's envSummaryLabel() — duplicated here for the same reason as
    // the other server/client pairs in this script.
    function envSummaryLabel(name, environmentCode) {
      var text = name || '(unnamed)';
      return environmentCode ? text + ' — ' + environmentCode : text;
    }

    // Keeps each environment card's collapsed-state summary (and the section's count) in sync with
    // its own Name/Environment code fields, so a specific environment stays identifiable collapsed.
    function refreshEnvironmentSummaries() {
      var cards = document.querySelectorAll('.environment-card');
      cards.forEach(function (card) {
        var name = card.querySelector('.env-name').value;
        var code = card.querySelector('.env-environment_code').value;
        card.querySelector('.environment-summary-label').textContent = envSummaryLabel(name, code);
      });
      var count = document.getElementById('environmentCount');
      if (count) {
        count.textContent = '(' + cards.length + ')';
      }
    }

    // Keeps the collapsed sections' "(N)" counts (Default variables / Dependencies / Required
    // permissions / Exposed API scopes / Federated Credentials) in sync with how many rows each
    // currently holds, so the collapsed sections stay informative. Called from notifyEdit(), which
    // fires on every add/remove/edit. The ".variable-row" selector is the top-level shared list
    // only (per-environment variable rows use a different class, ".env-var-row").
    function refreshSectionCounts() {
      var pairs = [
        ['variableCount', '.variable-row'],
        ['dependencyCount', '.dependency-row'],
        ['permissionCount', '.permission-row'],
        ['oauth2ScopeCount', '.oauth2-scope-card'],
        ['fedcredCount', '.fedcred-card'],
      ];
      pairs.forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (el) {
          el.textContent = '(' + document.querySelectorAll(pair[1]).length + ')';
        }
      });
    }

    // Mirrors applicationEditorHtml.ts's permissionIdFieldHtml() — duplicated here for the same
    // reason as the other server/client pairs in this script: it can't import that TS module.
    function permissionIdCellHtml(resourceAppId, permissionId) {
      var options = PERMISSION_OPTIONS_BY_RESOURCE_APP_ID[resourceAppId] || [];
      if (options.length === 0) {
        return '<input type="text" class="perm-id" placeholder="Permission ID" value="' + escapeHtml(permissionId) + '" />';
      }
      var matched = options.some(function (option) {
        return option.id === permissionId;
      });
      if (permissionId && !matched) {
        return (
          '<input type="text" class="perm-id" placeholder="Permission ID" value="' + escapeHtml(permissionId) + '" />' +
          '<span class="warning-icon" role="img" aria-label="Warning" title="Not found among the known permissions for this resource — shown as raw text.">⚠</span>'
        );
      }
      var optionsHtml = options
        .map(function (option) {
          return (
            '<option value="' +
            escapeHtml(option.id) +
            '" data-type="' +
            option.type +
            '"' +
            (permissionId === option.id ? ' selected' : '') +
            '>' +
            escapeHtml(option.label) +
            ' (' +
            option.type +
            ')</option>'
          );
        })
        .join('');
      return '<select class="perm-id">' + optionsHtml + '</select>';
    }

    // Rebuilds one row's Permission ID cell to match its (possibly just-changed) Resource App ID —
    // triggered on that field's own 'change' event, not on every edit, since rebuilding on every
    // keystroke elsewhere in the form would otherwise reset this cell (and any in-progress typing
    // in its own text-input fallback) for no reason.
    function refreshPermissionIdCell(row) {
      var resourceAppId = row.querySelector('.perm-resourceAppId').value;
      // A permission ID belongs to whichever resource it came from — Microsoft Graph's GUIDs and a
      // dependency's own scope values are different namespaces entirely, so a value picked/typed
      // for the *previous* resource is reset rather than carried forward: otherwise it would either
      // coincidentally (and wrongly) match an unrelated option in the new resource's list, or —
      // what was actually happening here — show up as an unmatched, warning-flagged raw value for a
      // resource it was never valid for in the first place (e.g. a Graph GUID left over after
      // switching to a Dependency).
      row.querySelector('.perm-id-cell').innerHTML = permissionIdCellHtml(resourceAppId, '');
    }

    function addPermissionRow() {
      appendRow(
        permissionRows,
        'row permission-row',
        '<select class="perm-resourceAppId">' +
          permissionResourceAppIdOptionsHtml('', currentDependencyKeys()) +
          '</select>' +
          '<span class="perm-id-cell">' +
          permissionIdCellHtml(MICROSOFT_GRAPH_APP_ID, '') +
          '</span>' +
          '<select class="perm-type">' +
          '<option value="Scope">Scope (delegated)</option>' +
          '<option value="Role">Role (application)</option>' +
          '</select>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addOauth2ScopeRow() {
      // Starts expanded (unlike a loaded scope, which starts collapsed) — the user just asked to
      // add one and almost certainly wants to fill it in immediately, not click to expand it first.
      const row = appendRow(
        oauth2ScopeRows,
        'oauth2-scope-card',
        '<summary class="oauth2-scope-summary">' +
          '<span class="oauth2-scope-summary-label">(no value)</span>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>' +
          '</summary>' +
          '<div class="oauth2-scope-body">' +
          '<input type="hidden" class="oauth2-scope-id" value="' + crypto.randomUUID() + '" />' +
          '<label>Scope value' +
          '<input type="text" class="oauth2-scope-value" placeholder="e.g. Files.Read" />' +
          '</label>' +
          '<label>ID variable name' +
          '<input type="text" class="oauth2-scope-idVariableName" placeholder="Optional, e.g. MyScopeId" title="If set, the scope\\'s ID is written as {{ environment.Variables.<this> }} instead of a fixed GUID." />' +
          '</label>' +
          '<label>Type' +
          '<select class="oauth2-scope-type">' +
          '<option value="User">User (delegated)</option>' +
          '<option value="Admin">Admin only</option>' +
          '</select>' +
          '</label>' +
          '<label class="oauth2-scope-enabled-label">' +
          '<input type="checkbox" class="oauth2-scope-isEnabled" checked />' +
          'Enabled' +
          '</label>' +
          '<label>Admin consent display name' +
          '<input type="text" class="oauth2-scope-adminConsentDisplayName" />' +
          '</label>' +
          '<label>Admin consent description' +
          '<input type="text" class="oauth2-scope-adminConsentDescription" />' +
          '</label>' +
          '<label>User consent display name' +
          '<input type="text" class="oauth2-scope-userConsentDisplayName" />' +
          '</label>' +
          '<label>User consent description' +
          '<input type="text" class="oauth2-scope-userConsentDescription" />' +
          '</label>' +
          '</div>',
        'details'
      );
      row.open = true;
    }

    function addFedCredRow() {
      // Starts expanded (a loaded credential starts collapsed) — same reasoning as addOauth2ScopeRow.
      const row = appendRow(
        fedcredRows,
        'fedcred-card',
        '<summary class="fedcred-summary">' +
          '<span class="fedcred-summary-label">(unnamed)</span>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>' +
          '</summary>' +
          '<div class="fedcred-body">' +
          '<label>Name' +
          '<input type="text" class="fedcred-name" />' +
          '</label>' +
          '<label>Issuer' +
          '<input type="text" class="fedcred-issuer" />' +
          '</label>' +
          '<label>Subject' +
          '<input type="text" class="fedcred-subject" />' +
          '</label>' +
          '<label>Audiences (comma-separated)' +
          '<input type="text" class="fedcred-audiences" />' +
          '</label>' +
          '<label>Description' +
          '<input type="text" class="fedcred-description" />' +
          '</label>' +
          '</div>',
        'details'
      );
      row.open = true;
    }

    function addTagRow() {
      appendRow(
        tagRows,
        'row tag-row',
        '<input type="text" class="tag-value" placeholder="Tag" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    document.querySelectorAll('.remove-row-btn').forEach(function (btn) {
      // The oauth2-scope-card / fedcred-card / environment-card entries are collapsible details
      // elements, not rows — matching only .row here would hand onRemoveClick a null and throw,
      // halting the rest of this script's setup (which is what broke every "+ Add ..." button once
      // those cards existed). .row is still listed first so a nested env-var row's own button
      // (which lives inside an environment-card) resolves to just that row, not the whole card.
      onRemoveClick(btn.closest('.row, .oauth2-scope-card, .fedcred-card, .environment-card'));
    });
    document.getElementById('addVariableBtn').addEventListener('click', addVariableRow);
    document.getElementById('addEnvironmentBtn').addEventListener('click', addEnvironmentRow);
    // Per-environment "+ Add variable" and the three "+ Add ... redirect URI" buttons appear N
    // times and can be added dynamically, so they're handled by delegation rather than wired
    // individually like the section-level ones.
    form.addEventListener('click', function (e) {
      if (e.target.classList.contains('add-env-var-btn')) {
        addEnvVariableRow(e.target.closest('.environment-card').querySelector('.env-var-rows'));
      } else if (e.target.classList.contains('add-env-redirect-btn')) {
        addEnvRedirectRow(e.target.closest('.env-redirect-subsection').querySelector('.env-redirect-rows'));
      }
    });
    document.getElementById('addDependencyBtn').addEventListener('click', addDependencyRow);
    document.getElementById('addPermissionBtn').addEventListener('click', addPermissionRow);
    document.getElementById('addOauth2ScopeBtn').addEventListener('click', addOauth2ScopeRow);
    document.getElementById('addFedCredBtn').addEventListener('click', addFedCredRow);
    document.getElementById('addTagBtn').addEventListener('click', addTagRow);
    document.getElementById('cancelBtn').addEventListener('click', function () {
      vscode.postMessage({ type: 'cancel' });
    });

    function clearErrors() {
      applicationNameError.classList.remove('visible');
      variablesError.classList.remove('visible');
      environmentsError.classList.remove('visible');
      dependenciesError.classList.remove('visible');
      tagsError.classList.remove('visible');
      generalError.classList.remove('visible');
    }

    function collectStringList(container, valueClass) {
      return Array.from(container.querySelectorAll('.' + valueClass)).map(function (input) {
        return input.value;
      });
    }

    function buildInputSnapshot() {
      const variables = Array.from(document.querySelectorAll('.variable-row')).map(function (row) {
        return {
          key: row.querySelector('.var-key').value,
          value: row.querySelector('.var-value').value,
        };
      });
      const environments = Array.from(document.querySelectorAll('.environment-card')).map(function (card) {
        const variables = Array.from(card.querySelectorAll('.env-var-row')).map(function (r) {
          return {
            key: r.querySelector('.env-var-key').value,
            value: r.querySelector('.env-var-value').value,
          };
        });
        function collectEnvRedirects(kind) {
          const container = card.querySelector('.env-redirect-rows[data-redirect-kind="' + kind + '"]');
          return container
            ? Array.from(container.querySelectorAll('.env-redirect-value')).map(function (i) {
                return i.value;
              })
            : [];
        }
        return {
          name: card.querySelector('.env-name').value,
          publisherDomain: card.querySelector('.env-publisherDomain').value,
          tenancy_type: card.querySelector('.env-tenancy_type').value,
          environment_code: card.querySelector('.env-environment_code').value,
          variables: variables,
          webRedirectUris: collectEnvRedirects('web'),
          publicClientRedirectUris: collectEnvRedirects('publicClient'),
          spaRedirectUris: collectEnvRedirects('spa'),
        };
      });
      const dependencies = Array.from(document.querySelectorAll('.dependency-row')).map(function (row) {
        return {
          key: row.querySelector('.dep-key').value,
          appName: row.querySelector('.dep-appName').value,
        };
      });
      const requiredPermissions = Array.from(document.querySelectorAll('.permission-row')).map(function (row) {
        return {
          resourceAppId: row.querySelector('.perm-resourceAppId').value,
          id: row.querySelector('.perm-id').value,
          type: row.querySelector('.perm-type').value,
        };
      });
      const oauth2PermissionScopes = Array.from(document.querySelectorAll('.oauth2-scope-card')).map(function (row) {
        return {
          id: row.querySelector('.oauth2-scope-id').value,
          idVariableName: row.querySelector('.oauth2-scope-idVariableName').value,
          value: row.querySelector('.oauth2-scope-value').value,
          type: row.querySelector('.oauth2-scope-type').value,
          isEnabled: row.querySelector('.oauth2-scope-isEnabled').checked,
          adminConsentDisplayName: row.querySelector('.oauth2-scope-adminConsentDisplayName').value,
          adminConsentDescription: row.querySelector('.oauth2-scope-adminConsentDescription').value,
          userConsentDisplayName: row.querySelector('.oauth2-scope-userConsentDisplayName').value,
          userConsentDescription: row.querySelector('.oauth2-scope-userConsentDescription').value,
        };
      });
      const federatedCredentials = Array.from(document.querySelectorAll('.fedcred-card')).map(function (row) {
        return {
          name: row.querySelector('.fedcred-name').value,
          issuer: row.querySelector('.fedcred-issuer').value,
          subject: row.querySelector('.fedcred-subject').value,
          audiences: row.querySelector('.fedcred-audiences').value,
          description: row.querySelector('.fedcred-description').value,
        };
      });

      return {
        application_name: applicationNameInput.value,
        business_unit: businessUnitInput.value,
        variables: variables,
        environments: environments,
        dependencies: dependencies,
        application: {
          displayName: document.getElementById('displayName').value,
          signInAudience: document.getElementById('signInAudience').value,
          requiredPermissions: requiredPermissions,
          oauth2PermissionScopes: oauth2PermissionScopes,
        },
        federatedCredentials: federatedCredentials,
        servicePrincipal: {
          appId: document.getElementById('appId').value,
          appRoleAssignmentRequired: document.getElementById('appRoleAssignmentRequired').checked,
          tags: collectStringList(tagRows, 'tag-value'),
        },
      };
    }

    // Notifies the extension host of the current form state on every relevant change, so the
    // document is marked dirty (VS Code's native "unsaved changes" tab indicator) as soon as
    // anything differs from what's on disk — not only when Save is explicitly clicked. Also keeps
    // the Required Permissions dropdowns in sync with the current Dependencies rows, and each
    // environment / Exposed API scope / federated credential card's collapsed summary in sync with
    // its own fields, before the snapshot below is taken (see refreshPermissionResourceAppIdOptions/
    // refreshEnvironmentSummaries/refreshOauth2ScopeSummaries/refreshFedCredSummaries).
    function notifyEdit() {
      refreshPermissionResourceAppIdOptions();
      refreshEnvironmentSummaries();
      refreshOauth2ScopeSummaries();
      refreshFedCredSummaries();
      refreshSectionCounts();
      vscode.postMessage({ type: 'edit', input: buildInputSnapshot() });
    }
    // A Permission ID's options depend on its row's Resource App ID, and picking a known Permission
    // ID implies a known Type — both react to their own 'change' event specifically (not every
    // edit, like refreshPermissionResourceAppIdOptions does) so a rebuild never interrupts typing
    // elsewhere on the row.
    form.addEventListener('change', function (e) {
      if (e.target.classList.contains('perm-resourceAppId')) {
        refreshPermissionIdCell(e.target.closest('.permission-row'));
      } else if (e.target.classList.contains('perm-id') && e.target.tagName === 'SELECT') {
        const selectedOption = e.target.selectedOptions[0];
        const type = selectedOption && selectedOption.getAttribute('data-type');
        if (type) {
          e.target.closest('.permission-row').querySelector('.perm-type').value = type;
        }
      }
    });

    form.addEventListener('input', notifyEdit);
    form.addEventListener('change', notifyEdit);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();
      vscode.postMessage({ type: 'submit', input: buildInputSnapshot() });
    });

    window.addEventListener('message', function (event) {
      const message = event.data;
      if (message.kind === 'missingApplicationName') {
        applicationNameError.classList.add('visible');
      } else if (message.kind === 'missingVariableKey') {
        variablesError.textContent = 'Every variable needs a key (remove any row you don\\'t need).';
        variablesError.classList.add('visible');
      } else if (message.kind === 'duplicateVariableKey') {
        variablesError.textContent = 'The variable key "' + message.key + '" is used more than once.';
        variablesError.classList.add('visible');
      } else if (message.kind === 'missingEnvironmentName') {
        environmentsError.textContent = 'Every environment needs a name (remove any row you don\\'t need).';
        environmentsError.classList.add('visible');
      } else if (message.kind === 'duplicateEnvironmentName') {
        environmentsError.textContent = 'The environment name "' + message.name + '" is used more than once.';
        environmentsError.classList.add('visible');
      } else if (message.kind === 'missingEnvironmentVariableKey') {
        environmentsError.textContent =
          'A variable in environment "' + message.environment + '" needs a key (remove any row you don\\'t need).';
        environmentsError.classList.add('visible');
      } else if (message.kind === 'duplicateEnvironmentVariableKey') {
        environmentsError.textContent =
          'Environment "' + message.environment + '" uses the variable key "' + message.key + '" more than once.';
        environmentsError.classList.add('visible');
      } else if (message.kind === 'missingDependencyKey') {
        dependenciesError.textContent = 'Every dependency needs a reference key (remove any row you don\\'t need).';
        dependenciesError.classList.add('visible');
      } else if (message.kind === 'missingDependencyAppName') {
        dependenciesError.textContent = 'The dependency "' + message.key + '" needs an application selected.';
        dependenciesError.classList.add('visible');
      } else if (message.kind === 'duplicateDependencyKey') {
        dependenciesError.textContent = 'The dependency reference key "' + message.key + '" is used more than once.';
        dependenciesError.classList.add('visible');
      } else if (message.kind === 'reservedTagPrefix') {
        tagsError.textContent =
          'The tag "' + message.tag + '" starts with the reserved prefix "' + message.prefix +
          '", which is generated automatically at deploy time (see the preview above). Remove or rename this custom tag.';
        tagsError.classList.add('visible');
      } else if (message.type === 'error') {
        generalError.textContent = message.message;
        generalError.classList.add('visible');
      }
      // A validation error inside a collapsed section would otherwise be invisible — expand the
      // section holding whichever error just became visible, and bring it into view.
      var shownError = form.querySelector('.error.visible');
      if (shownError) {
        // Open every ancestor <details> (sections can nest — Required permissions / Exposed API
        // scopes live inside the collapsible Application section), not just the nearest one.
        var node = shownError.parentElement;
        while (node) {
          if (node.tagName === 'DETAILS') {
            node.open = true;
          }
          node = node.parentElement;
        }
        if (shownError.scrollIntoView) {
          shownError.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  })();
</script>
</body>
</html>`;
}
