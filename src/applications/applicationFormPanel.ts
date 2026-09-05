import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ApplicationStore } from './applicationStore';
import { resolveApplicationSubmit, ApplicationFormInput } from './applicationFormLogic';
import { ApplicationFiles, AppConfig, RequiredPermission, FederatedCredentialEntry } from './types';

interface SubmitMessage {
  type: 'submit';
  input: ApplicationFormInput;
}
interface CancelMessage {
  type: 'cancel';
}
type IncomingMessage = SubmitMessage | CancelMessage;

/**
 * UC042 — a structured, editable view of one application's four files (UC040), replacing
 * separately opening each raw file. Saving serializes all four back to disk as YAML — see
 * ApplicationStore for the accepted comment/anchor/unmodelled-field loss this implies. One panel
 * per application folder — clicking an already-open application reveals its existing panel rather
 * than opening a duplicate.
 */
export class ApplicationFormPanel {
  private static readonly openPanels = new Map<string, ApplicationFormPanel>();

  private readonly panel: vscode.WebviewPanel;

  static show(store: ApplicationStore, folderUri: vscode.Uri, name: string): void {
    const key = folderUri.toString();
    const existing = ApplicationFormPanel.openPanels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const created = new ApplicationFormPanel(store, folderUri, name);
    ApplicationFormPanel.openPanels.set(key, created);
  }

  private constructor(
    private readonly store: ApplicationStore,
    private readonly folderUri: vscode.Uri,
    private readonly name: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'entra.applicationForm',
      `Application: ${name}`,
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    this.panel.onDidDispose(() => {
      ApplicationFormPanel.openPanels.delete(this.folderUri.toString());
    });

    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => void this.handleMessage(message));

    void this.render();
  }

  private async render(): Promise<void> {
    const files = await this.store.load(this.folderUri);
    this.panel.webview.html = getHtml(this.name, files);
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    if (message.type === 'cancel') {
      this.panel.dispose();
      return;
    }

    const resolution = resolveApplicationSubmit(message.input);
    if (resolution.kind !== 'ok') {
      void this.panel.webview.postMessage(resolution);
      return;
    }

    try {
      await this.store.save(this.folderUri, resolution.files);
      this.panel.dispose();
      void vscode.window.showInformationMessage(`Saved application "${this.name}".`);
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

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

function environmentRowsHtml(appConfig: AppConfig): string {
  return appConfig.Environments.map(
    (env) => `
    <div class="row environment-row">
      <input type="text" class="env-name" placeholder="Name (e.g. Dev)" value="${escapeHtml(env.name)}" />
      <input type="text" class="env-publisherDomain" placeholder="Publisher domain" value="${escapeHtml(env.publisherDomain)}" />
      <input type="text" class="env-tenancy_type" placeholder="Tenancy type (e.g. ciam)" value="${escapeHtml(env.tenancy_type)}" />
      <input type="text" class="env-environment_code" placeholder="Environment code" value="${escapeHtml(env.environment_code)}" />
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
  ).join('');
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

function requiredPermissionRowsHtml(rows: readonly RequiredPermission[]): string {
  return rows
    .map(
      (row) => `
    <div class="row permission-row">
      <input type="text" class="perm-resourceAppId" placeholder="Resource App ID" value="${escapeHtml(row.resourceAppId)}" />
      <input type="text" class="perm-id" placeholder="Permission ID" value="${escapeHtml(row.id)}" />
      <select class="perm-type">
        <option value="Scope" ${selectedAttr(row.type, 'Scope')}>Scope (delegated)</option>
        <option value="Role" ${selectedAttr(row.type, 'Role')}>Role (application)</option>
      </select>
      <button type="button" class="remove-row-btn" aria-label="Remove">✕</button>
    </div>`
    )
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

function getHtml(name: string, files: ApplicationFiles): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const { appConfig, application, federatedCredentials, servicePrincipal } = files;

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
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .row input, .row select { flex: 1; min-width: 0; }
  .fedcred-row-grid { flex-wrap: wrap; }
  .fedcred-row-grid input { flex: 1 1 30%; }
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
  <div class="subtitle">Editing this application's four files as one structured view. Saving writes all four back to disk — comments and other hand-written formatting are not preserved (see UC042); review changes with <code>git diff</code> before committing.</div>

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
    <div class="hint">One row per permission — rows sharing a Resource App ID are grouped together when saved.</div>
    <div id="permissionRows">${requiredPermissionRowsHtml(application.requiredPermissions)}</div>
    <button type="button" class="add-row-btn" id="addPermissionBtn">+ Add permission</button>

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
    <div id="tagRows">${stringListRowsHtml(servicePrincipal.tags, 'tag', 'Tag')}</div>
    <button type="button" class="add-row-btn" id="addTagBtn">+ Add tag</button>

    <div class="error" id="generalError"></div>

    <div class="actions">
      <button type="submit" class="primary">Save</button>
      <button type="button" class="secondary" id="cancelBtn">Cancel</button>
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
    const redirectUriRows = document.getElementById('redirectUriRows');
    const permissionRows = document.getElementById('permissionRows');
    const fedcredRows = document.getElementById('fedcredRows');
    const tagRows = document.getElementById('tagRows');
    const generalError = document.getElementById('generalError');

    function onRemoveClick(row) {
      row.querySelector('.remove-row-btn').addEventListener('click', function () {
        row.remove();
      });
    }

    function appendRow(container, className, html) {
      const row = document.createElement('div');
      row.className = className;
      row.innerHTML = html;
      container.appendChild(row);
      onRemoveClick(row);
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
        '<input type="text" class="env-name" placeholder="Name (e.g. Dev)" />' +
          '<input type="text" class="env-publisherDomain" placeholder="Publisher domain" />' +
          '<input type="text" class="env-tenancy_type" placeholder="Tenancy type (e.g. ciam)" />' +
          '<input type="text" class="env-environment_code" placeholder="Environment code" />' +
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

    function addPermissionRow() {
      appendRow(
        permissionRows,
        'row permission-row',
        '<input type="text" class="perm-resourceAppId" placeholder="Resource App ID" />' +
          '<input type="text" class="perm-id" placeholder="Permission ID" />' +
          '<select class="perm-type">' +
          '<option value="Scope">Scope (delegated)</option>' +
          '<option value="Role">Role (application)</option>' +
          '</select>' +
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
      btn.addEventListener('click', function () {
        btn.closest('.row').remove();
      });
    });
    document.getElementById('addVariableBtn').addEventListener('click', addVariableRow);
    document.getElementById('addEnvironmentBtn').addEventListener('click', addEnvironmentRow);
    document.getElementById('addRedirectUriBtn').addEventListener('click', addRedirectUriRow);
    document.getElementById('addPermissionBtn').addEventListener('click', addPermissionRow);
    document.getElementById('addFedCredBtn').addEventListener('click', addFedCredRow);
    document.getElementById('addTagBtn').addEventListener('click', addTagRow);
    document.getElementById('cancelBtn').addEventListener('click', function () {
      vscode.postMessage({ type: 'cancel' });
    });

    function clearErrors() {
      applicationNameError.classList.remove('visible');
      variablesError.classList.remove('visible');
      environmentsError.classList.remove('visible');
      generalError.classList.remove('visible');
    }

    function collectStringList(container, valueClass) {
      return Array.from(container.querySelectorAll('.' + valueClass)).map(function (input) {
        return input.value;
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();

      const variables = Array.from(document.querySelectorAll('.variable-row')).map(function (row) {
        return {
          key: row.querySelector('.var-key').value,
          value: row.querySelector('.var-value').value,
        };
      });
      const environments = Array.from(document.querySelectorAll('.environment-row')).map(function (row) {
        return {
          name: row.querySelector('.env-name').value,
          publisherDomain: row.querySelector('.env-publisherDomain').value,
          tenancy_type: row.querySelector('.env-tenancy_type').value,
          environment_code: row.querySelector('.env-environment_code').value,
        };
      });
      const requiredPermissions = Array.from(document.querySelectorAll('.permission-row')).map(function (row) {
        return {
          resourceAppId: row.querySelector('.perm-resourceAppId').value,
          id: row.querySelector('.perm-id').value,
          type: row.querySelector('.perm-type').value,
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

      vscode.postMessage({
        type: 'submit',
        input: {
          application_name: applicationNameInput.value,
          business_unit: document.getElementById('businessUnit').value,
          variables: variables,
          environments: environments,
          application: {
            displayName: document.getElementById('displayName').value,
            signInAudience: document.getElementById('signInAudience').value,
            redirectUris: collectStringList(redirectUriRows, 'redirecturi-value'),
            requiredPermissions: requiredPermissions,
          },
          federatedCredentials: federatedCredentials,
          servicePrincipal: {
            appId: document.getElementById('appId').value,
            appRoleAssignmentRequired: document.getElementById('appRoleAssignmentRequired').checked,
            tags: collectStringList(tagRows, 'tag-value'),
          },
        },
      });
    });

    window.addEventListener('message', function (event) {
      const message = event.data;
      if (message.type === 'missingApplicationName') {
        applicationNameError.classList.add('visible');
      } else if (message.type === 'missingVariableKey') {
        variablesError.textContent = 'Every variable needs a key (remove any row you don\\'t need).';
        variablesError.classList.add('visible');
      } else if (message.type === 'duplicateVariableKey') {
        variablesError.textContent = 'The variable key "' + message.key + '" is used more than once.';
        variablesError.classList.add('visible');
      } else if (message.type === 'missingEnvironmentName') {
        environmentsError.textContent = 'Every environment needs a name (remove any row you don\\'t need).';
        environmentsError.classList.add('visible');
      } else if (message.type === 'duplicateEnvironmentName') {
        environmentsError.textContent = 'The environment name "' + message.name + '" is used more than once.';
        environmentsError.classList.add('visible');
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
