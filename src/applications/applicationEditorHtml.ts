import * as crypto from 'crypto';
import { ApplicationFiles, AppConfig, RequiredPermission, Oauth2PermissionScopeEntry, FederatedCredentialEntry } from './types';
import { MICROSOFT_GRAPH_APP_ID, parseResourceAppId, buildDependencyReference } from './resourceAppIdReference';
import { parseEnvironmentVariableIdName } from './oauth2ScopeIdReference';

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

/**
 * `env.Variables` (see EnvironmentEntry's doc comment — distinct from AppConfig's own top-level
 * `Variables`) has no dedicated editing UI of its own yet, so it's round-tripped here as a hidden,
 * JSON-encoded field rather than dropped: unedited by this row, but preserved on save (and
 * added to by `ensureOauth2ScopeIdVariablesInEnvironments` in applicationFormLogic.ts) rather than
 * silently lost every time this form is saved.
 */
function environmentRowsHtml(appConfig: AppConfig): string {
  return appConfig.Environments.map(
    (env) => `
    <div class="row environment-row">
      <input type="hidden" class="env-variables" value="${escapeHtml(JSON.stringify(env.Variables))}" />
      <input type="text" class="env-name" placeholder="Name (e.g. Dev)" value="${escapeHtml(env.name)}" />
      <input type="text" class="env-publisherDomain" placeholder="Publisher domain" value="${escapeHtml(env.publisherDomain)}" />
      <select class="env-tenancy_type">
        <option value="workforce" ${selectedAttr(env.tenancy_type, 'workforce')}>Workforce</option>
        <option value="ciam" ${selectedAttr(env.tenancy_type, 'ciam')}>CIAM</option>
      </select>
      <input type="text" class="env-environment_code" placeholder="Environment code" value="${escapeHtml(env.environment_code)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
  ).join('');
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
 * A row's `resourceAppId` renders as the dropdown above when it matches one of the two recognised
 * shapes, or — when it doesn't (a hand-edited file, a reference to a since-renamed/removed
 * dependency, or a raw third-party GUID this form doesn't model) — as plain text with a warning
 * icon instead, so the value is never silently discarded or misrepresented (see UC042).
 */
function requiredPermissionRowsHtml(rows: readonly RequiredPermission[], dependencyKeys: readonly string[]): string {
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
      <input type="text" class="perm-id" placeholder="Permission ID" value="${escapeHtml(row.id)}" />
      <select class="perm-type">
        <option value="Scope" ${selectedAttr(row.type, 'Scope')}>Scope (delegated)</option>
        <option value="Role" ${selectedAttr(row.type, 'Role')}>Role (application)</option>
      </select>
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`;
    })
    .join('');
}

/**
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
    <div class="row oauth2-scope-row oauth2-scope-row-grid">
      <input type="hidden" class="oauth2-scope-id" value="${escapeHtml(id)}" />
      <input type="text" class="oauth2-scope-value" placeholder="Scope value (e.g. Files.Read)" value="${escapeHtml(scope.value)}" />
      <input type="text" class="oauth2-scope-idVariableName" placeholder="ID variable name (optional, e.g. MyScopeId)" value="${escapeHtml(idVariableName)}" title="If set, the scope's ID is written as {{ environment.Variables.<this> }} instead of a fixed GUID." />
      <select class="oauth2-scope-type">
        <option value="User" ${selectedAttr(scope.type, 'User')}>User (delegated)</option>
        <option value="Admin" ${selectedAttr(scope.type, 'Admin')}>Admin only</option>
      </select>
      <label class="oauth2-scope-enabled-label">
        <input type="checkbox" class="oauth2-scope-isEnabled" ${scope.isEnabled ? 'checked' : ''} />
        Enabled
      </label>
      <input type="text" class="oauth2-scope-adminConsentDisplayName" placeholder="Admin consent display name" value="${escapeHtml(scope.adminConsentDisplayName)}" />
      <input type="text" class="oauth2-scope-adminConsentDescription" placeholder="Admin consent description" value="${escapeHtml(scope.adminConsentDescription)}" />
      <input type="text" class="oauth2-scope-userConsentDisplayName" placeholder="User consent display name" value="${escapeHtml(scope.userConsentDisplayName)}" />
      <input type="text" class="oauth2-scope-userConsentDescription" placeholder="User consent description" value="${escapeHtml(scope.userConsentDescription)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`;
    })
    .join('');
}

function federatedCredentialRowsHtml(entries: readonly FederatedCredentialEntry[]): string {
  return entries
    .map(
      (entry) => `
    <div class="row fedcred-row fedcred-row-grid">
      <input type="text" class="fedcred-name" placeholder="Name" value="${escapeHtml(entry.name)}" />
      <input type="text" class="fedcred-issuer" placeholder="Issuer" value="${escapeHtml(entry.issuer)}" />
      <input type="text" class="fedcred-subject" placeholder="Subject" value="${escapeHtml(entry.subject)}" />
      <input type="text" class="fedcred-audiences" placeholder="Audiences (comma-separated)" value="${escapeHtml(entry.audiences.join(', '))}" />
      <input type="text" class="fedcred-description" placeholder="Description" value="${escapeHtml(entry.description)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
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
export function getHtml(name: string, files: ApplicationFiles, dependencyAppOptions: readonly string[]): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const { appConfig, application, federatedCredentials, servicePrincipal } = files;
  const dependencyAppOptionsJson = JSON.stringify(dependencyAppOptions).replace(/</g, '\\u003c');
  const microsoftGraphAppIdJson = JSON.stringify(MICROSOFT_GRAPH_APP_ID);

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
  .fedcred-row-grid { flex-wrap: wrap; }
  .fedcred-row-grid input { flex: 1 1 30%; }
  .oauth2-scope-row-grid { flex-wrap: wrap; }
  .oauth2-scope-row-grid input[type="text"], .oauth2-scope-row-grid select { flex: 1 1 30%; }
  .oauth2-scope-enabled-label {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
  }
  .oauth2-scope-enabled-label input { width: auto; }
  .perm-resourceAppId-wrap { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
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

    <h2>Variables</h2>
    <div class="hint">Default values shared across every environment below.</div>
    <div id="variableRows">${variableRowsHtml(appConfig)}</div>
    <button type="button" class="add-row-btn" id="addVariableBtn">+ Add variable</button>
    <div class="error" id="variablesError"></div>

    <h2>Environments</h2>
    <div class="hint">One deployment target per row.</div>
    <div id="environmentRows">${environmentRowsHtml(appConfig)}</div>
    <button type="button" class="add-row-btn" id="addEnvironmentBtn">+ Add environment</button>
    <div class="error" id="environmentsError"></div>

    <h2>Dependencies</h2>
    <div class="hint">Other applications this one depends on for deploy sequencing. Reference one in a template as <code>{{ dependency_refs.&lt;Key&gt;.applicationId }}</code>, resolved once the referenced application has been deployed.</div>
    <div id="dependencyRows">${dependencyRowsHtml(appConfig, dependencyAppOptions)}</div>
    <button type="button" class="add-row-btn" id="addDependencyBtn">+ Add dependency</button>
    <div class="error" id="dependenciesError"></div>

    <hr />

    <h2>Application (App Registration)</h2>
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

    <h3>Redirect URIs</h3>
    <div id="redirectUriRows">${stringListRowsHtml(application.redirectUris, 'redirecturi', 'https://example.com/signin-oidc')}</div>
    <button type="button" class="add-row-btn" id="addRedirectUriBtn">+ Add redirect URI</button>

    <h3>Required permissions</h3>
    <div class="hint">One row per permission — rows sharing a Resource App ID are grouped together when saved. Resource App ID is either Microsoft Graph or one of this application's Dependencies (added above); a value that's neither (e.g. from a hand-edited file, or referencing a dependency since renamed or removed) is shown as plain text with a ⚠ warning instead.</div>
    <div id="permissionRows">${requiredPermissionRowsHtml(application.requiredPermissions, Object.keys(appConfig.Dependencies))}</div>
    <button type="button" class="add-row-btn" id="addPermissionBtn">+ Add permission</button>

    <h3>Exposed API scopes (oauth2PermissionScopes)</h3>
    <div class="hint">Delegated permission scopes this application exposes for other applications to request — Graph's <code>api.oauth2PermissionScopes</code>. Each scope's ID is generated automatically and kept stable across saves, so a previously deployed scope is updated in place rather than replaced — or give it an <strong>ID variable name</strong> to write the ID as <code>{{ environment.Variables.&lt;name&gt; }}</code> instead, resolved per environment once deploy tooling exists.</div>
    <div id="oauth2ScopeRows">${oauth2PermissionScopeRowsHtml(application.oauth2PermissionScopes)}</div>
    <button type="button" class="add-row-btn" id="addOauth2ScopeBtn">+ Add scope</button>

    <h2>Federated Credentials</h2>
    <div class="hint">FederatedCredentials.yaml.j2 — one row per credential.</div>
    <div id="fedcredRows">${federatedCredentialRowsHtml(federatedCredentials)}</div>
    <button type="button" class="add-row-btn" id="addFedCredBtn">+ Add federated credential</button>

    <h2>Service Principal</h2>
    <div class="hint">ServicePrincipal.yaml.j2 — mirrors the Graph JSON body for the Enterprise Application.</div>

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
    const redirectUriRows = document.getElementById('redirectUriRows');
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
      row.querySelector('.remove-row-btn').addEventListener('click', function () {
        row.remove();
        notifyEdit();
      });
    }

    function appendRow(container, className, html) {
      const row = document.createElement('div');
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
      appendRow(
        environmentRows,
        'row environment-row',
        '<input type="hidden" class="env-variables" value="{}" />' +
          '<input type="text" class="env-name" placeholder="Name (e.g. Dev)" />' +
          '<input type="text" class="env-publisherDomain" placeholder="Publisher domain" />' +
          '<select class="env-tenancy_type">' +
          '<option value="workforce">Workforce</option>' +
          '<option value="ciam">CIAM</option>' +
          '</select>' +
          '<input type="text" class="env-environment_code" placeholder="Environment code" />' +
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

    function addRedirectUriRow() {
      appendRow(
        redirectUriRows,
        'row redirecturi-row',
        '<input type="text" class="redirecturi-value" placeholder="https://example.com/signin-oidc" />' +
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

    function addPermissionRow() {
      appendRow(
        permissionRows,
        'row permission-row',
        '<select class="perm-resourceAppId">' +
          permissionResourceAppIdOptionsHtml('', currentDependencyKeys()) +
          '</select>' +
          '<input type="text" class="perm-id" placeholder="Permission ID" />' +
          '<select class="perm-type">' +
          '<option value="Scope">Scope (delegated)</option>' +
          '<option value="Role">Role (application)</option>' +
          '</select>' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addOauth2ScopeRow() {
      appendRow(
        oauth2ScopeRows,
        'row oauth2-scope-row oauth2-scope-row-grid',
        '<input type="hidden" class="oauth2-scope-id" value="' + crypto.randomUUID() + '" />' +
          '<input type="text" class="oauth2-scope-value" placeholder="Scope value (e.g. Files.Read)" />' +
          '<input type="text" class="oauth2-scope-idVariableName" placeholder="ID variable name (optional, e.g. MyScopeId)" title="If set, the scope\\'s ID is written as {{ environment.Variables.<this> }} instead of a fixed GUID." />' +
          '<select class="oauth2-scope-type">' +
          '<option value="User">User (delegated)</option>' +
          '<option value="Admin">Admin only</option>' +
          '</select>' +
          '<label class="oauth2-scope-enabled-label">' +
          '<input type="checkbox" class="oauth2-scope-isEnabled" checked />' +
          'Enabled' +
          '</label>' +
          '<input type="text" class="oauth2-scope-adminConsentDisplayName" placeholder="Admin consent display name" />' +
          '<input type="text" class="oauth2-scope-adminConsentDescription" placeholder="Admin consent description" />' +
          '<input type="text" class="oauth2-scope-userConsentDisplayName" placeholder="User consent display name" />' +
          '<input type="text" class="oauth2-scope-userConsentDescription" placeholder="User consent description" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
    }

    function addFedCredRow() {
      appendRow(
        fedcredRows,
        'row fedcred-row fedcred-row-grid',
        '<input type="text" class="fedcred-name" placeholder="Name" />' +
          '<input type="text" class="fedcred-issuer" placeholder="Issuer" />' +
          '<input type="text" class="fedcred-subject" placeholder="Subject" />' +
          '<input type="text" class="fedcred-audiences" placeholder="Audiences (comma-separated)" />' +
          '<input type="text" class="fedcred-description" placeholder="Description" />' +
          '<button type="button" class="remove-row-btn" aria-label="Remove">✕</button>'
      );
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
      onRemoveClick(btn.closest('.row'));
    });
    document.getElementById('addVariableBtn').addEventListener('click', addVariableRow);
    document.getElementById('addEnvironmentBtn').addEventListener('click', addEnvironmentRow);
    document.getElementById('addDependencyBtn').addEventListener('click', addDependencyRow);
    document.getElementById('addRedirectUriBtn').addEventListener('click', addRedirectUriRow);
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
      const environments = Array.from(document.querySelectorAll('.environment-row')).map(function (row) {
        let variables = {};
        try {
          variables = JSON.parse(row.querySelector('.env-variables').value || '{}');
        } catch (e) {
          variables = {};
        }
        return {
          name: row.querySelector('.env-name').value,
          publisherDomain: row.querySelector('.env-publisherDomain').value,
          tenancy_type: row.querySelector('.env-tenancy_type').value,
          environment_code: row.querySelector('.env-environment_code').value,
          variables: variables,
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
      const oauth2PermissionScopes = Array.from(document.querySelectorAll('.oauth2-scope-row')).map(function (row) {
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
      const federatedCredentials = Array.from(document.querySelectorAll('.fedcred-row')).map(function (row) {
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
          redirectUris: collectStringList(redirectUriRows, 'redirecturi-value'),
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
    // the Required Permissions dropdowns in sync with the current Dependencies rows first (see
    // refreshPermissionResourceAppIdOptions), so the snapshot below reflects that refreshed state.
    function notifyEdit() {
      refreshPermissionResourceAppIdOptions();
      vscode.postMessage({ type: 'edit', input: buildInputSnapshot() });
    }
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
    });
  })();
</script>
</body>
</html>`;
}
