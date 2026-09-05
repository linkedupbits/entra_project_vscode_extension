import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Connection, Cloud, TenantKind, AuthMethod } from './types';
import { ConnectionStore } from './connectionStore';
import { AuthService } from '../auth/authService';
import { CredentialStore } from '../auth/credentialStore';
import {
  resolveSubmit,
  authorityOrIdentityChanged,
  titleFor,
  escapeHtml,
  isCloudSelected,
  isTenantKindSelected,
  isAuthMethodSelected,
  ExistingCredentialState,
} from './connectionFormLogic';

interface SubmitMessage {
  type: 'submit';
  connection: {
    name: string;
    tenantId: string;
    cloud: Cloud;
    clientId: string;
    tenantKind: TenantKind;
    externalIdSubdomain: string;
    authMethod: AuthMethod;
    clientSecret: string;
    certificateThumbprint: string;
    certificateKey: string;
  };
}
interface EditExistingMessage {
  type: 'editExisting';
  name: string;
}
interface CancelMessage {
  type: 'cancel';
}
type IncomingMessage = SubmitMessage | EditExistingMessage | CancelMessage;

/**
 * UC012 (Add Connection) / UC012 A3 (Edit Connection), implemented as a webview form rather
 * than a sequence of input boxes. One panel at a time — reopening replaces whatever is showing.
 */
export class ConnectionFormPanel {
  private static current: ConnectionFormPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  static show(
    store: ConnectionStore,
    authService: AuthService,
    credentials: CredentialStore,
    editing: Connection | undefined
  ): void {
    if (ConnectionFormPanel.current) {
      ConnectionFormPanel.current.panel.dispose();
    }
    ConnectionFormPanel.current = new ConnectionFormPanel(store, authService, credentials, editing);
  }

  private constructor(
    private readonly store: ConnectionStore,
    private readonly authService: AuthService,
    private readonly credentials: CredentialStore,
    private editing: Connection | undefined
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'entra.connectionForm',
      titleFor(editing),
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    this.panel.onDidDispose(() => {
      if (ConnectionFormPanel.current === this) {
        ConnectionFormPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => void this.handleMessage(message));

    void this.render();
  }

  private async render(): Promise<void> {
    this.panel.title = titleFor(this.editing);
    const existing = await this.store.list();
    const credentialState = await this.currentCredentialState();
    this.panel.webview.html = getHtml(this.editing, existing, credentialState);
  }

  private async currentCredentialState(): Promise<ExistingCredentialState> {
    if (!this.editing) {
      return { hasClientSecret: false, hasCertificateKey: false };
    }
    const [secret, certificateKey] = await Promise.all([
      this.credentials.getClientSecret(this.editing.name),
      this.credentials.getCertificateKey(this.editing.name),
    ]);
    return { hasClientSecret: Boolean(secret), hasCertificateKey: Boolean(certificateKey) };
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    switch (message.type) {
      case 'cancel':
        this.panel.dispose();
        return;

      case 'editExisting': {
        const existing = await this.store.list();
        const clash = existing.find((c) => c.name.toLowerCase() === message.name.trim().toLowerCase());
        if (clash) {
          this.editing = clash;
          await this.render();
        }
        return;
      }

      case 'submit':
        await this.submit(message.connection);
        return;
    }
  }

  private async submit(input: SubmitMessage['connection']): Promise<void> {
    const existing = await this.store.list();
    const existingCredentials = await this.currentCredentialState();
    // A1 — name already in use; A4/A5/A6 — field-format/required-field problems: all reported
    // back rather than letting store.add()/update() throw, so the webview can surface them inline.
    const resolution = resolveSubmit(existing, this.editing?.name, input, existingCredentials);
    if (resolution.kind !== 'ok') {
      void this.panel.webview.postMessage({ type: resolution.kind, name: 'name' in resolution ? resolution.name : undefined });
      return;
    }

    const { connection, clientSecret, certificateKey } = resolution;
    try {
      const original = this.editing;
      if (original) {
        await this.store.update(original.name, connection);
        if (original.name !== connection.name) {
          await this.credentials.renameConnection(original.name, connection.name);
        }
        const oldAuthMethod = original.authMethod ?? 'delegated';
        if (oldAuthMethod !== connection.authMethod && oldAuthMethod !== 'delegated') {
          // Switched away from an app-only method: drop its now-orphaned stored credential.
          await this.credentials.clearForConnection(connection.name);
        }
        if (clientSecret) {
          await this.credentials.setClientSecret(connection.name, clientSecret);
        }
        if (certificateKey) {
          await this.credentials.setCertificateKey(connection.name, certificateKey);
        }
        const credentialChanged = Boolean(clientSecret || certificateKey);
        if ((authorityOrIdentityChanged(original, connection) || credentialChanged) && this.authService.isConnected(original.name)) {
          await this.authService.disconnect(original.name);
        }
      } else {
        await this.store.add(connection);
        if (clientSecret) {
          await this.credentials.setClientSecret(connection.name, clientSecret);
        }
        if (certificateKey) {
          await this.credentials.setCertificateKey(connection.name, certificateKey);
        }
      }
      this.panel.dispose();
      void vscode.window.showInformationMessage(
        original ? `Updated connection "${connection.name}".` : `Added connection "${connection.name}".`
      );
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

function selectedAttr(current: Cloud | undefined, option: Cloud): string {
  return isCloudSelected(current, option) ? 'selected' : '';
}

function tenantKindCheckedAttr(current: TenantKind | undefined, option: TenantKind): string {
  return isTenantKindSelected(current, option) ? 'checked' : '';
}

function authMethodCheckedAttr(current: AuthMethod | undefined, option: AuthMethod): string {
  return isAuthMethodSelected(current, option) ? 'checked' : '';
}

function getHtml(editing: Connection | undefined, existing: Connection[], credentialState: ExistingCredentialState): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const heading = editing ? 'Edit Connection' : 'Add Connection';
  const subtitle = editing
    ? `Editing "${escapeHtml(editing.name)}".`
    : 'Save the details needed to connect to an Entra tenant. No sign-in happens here.';
  const otherNamesJson = JSON.stringify(
    existing.filter((c) => c.name !== editing?.name).map((c) => c.name.toLowerCase())
  );
  const isExternalId = isTenantKindSelected(editing?.tenantKind, 'externalId');
  const authMethod = editing?.authMethod ?? 'delegated';
  const credentialStateJson = JSON.stringify(credentialState);

  const clientSecretHint = credentialState.hasClientSecret
    ? 'A secret is already stored for this connection. Leave blank to keep it, or enter a new one to replace it.'
    : 'Required — from the App Registration\'s "Certificates & secrets" page. Stored only in VS Code\'s secret storage, never in this project.';
  const certificateKeyHint = credentialState.hasCertificateKey
    ? 'A private key is already stored for this connection. Leave blank to keep it, or paste a new one to replace it.'
    : 'Required — the PEM-encoded private key matching the thumbprint above. Stored only in VS Code\'s secret storage, never in this project.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${heading}</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 24px;
    max-width: 520px;
  }
  h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
  label { display: block; margin-top: 16px; margin-bottom: 4px; font-weight: 600; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 4px; }
  input[type="text"], input[type="password"], select, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    font-size: 1em;
    font-family: inherit;
  }
  textarea {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
    min-height: 90px;
    resize: vertical;
  }
  input:focus, select:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .radio-group { display: flex; flex-direction: column; gap: 6px; }
  .radio-group label {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-weight: normal;
    margin-top: 0;
  }
  .radio-group input[type="radio"] { width: auto; }
  .field { display: block; }
  .field.hidden { display: none; }
  hr { border: none; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); margin: 24px 0 0; }
  .error {
    color: var(--vscode-errorForeground);
    font-size: 0.9em;
    margin-top: 4px;
    display: none;
  }
  .error.visible { display: block; }
  .actions { margin-top: 24px; display: flex; gap: 8px; }
  button {
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
  button.link {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    text-decoration: underline;
    padding: 0;
    display: block;
    margin-top: 6px;
  }
</style>
</head>
<body>
  <h1>${heading}</h1>
  <div class="subtitle">${subtitle}</div>
  <form id="form">
    <label for="name">Name</label>
    <div class="hint">A short, unique name for this connection (shown in the Entra tree).</div>
    <input type="text" id="name" name="name" value="${escapeHtml(editing?.name ?? '')}" autofocus />
    <div class="error" id="nameError"></div>
    <div class="error" id="clashError">
      <span id="clashMessage"></span>
      <button type="button" class="link" id="editExistingBtn">Edit the existing connection instead</button>
    </div>

    <label>Tenant type</label>
    <div class="radio-group">
      <label><input type="radio" name="tenantKind" value="workforce" ${tenantKindCheckedAttr(editing?.tenantKind, 'workforce')} /> Entra Workforce (standard tenant)</label>
      <label><input type="radio" name="tenantKind" value="externalId" ${tenantKindCheckedAttr(editing?.tenantKind, 'externalId')} /> Entra External ID (CIAM)</label>
    </div>

    <label for="tenantId">Tenant ID</label>
    <div class="hint">Entra tenant ID or verified domain name (e.g. contoso.onmicrosoft.com).</div>
    <input type="text" id="tenantId" name="tenantId" value="${escapeHtml(editing?.tenantId ?? '')}" />
    <div class="error" id="tenantIdError"></div>

    <div class="field${isExternalId ? '' : ' hidden'}" id="externalIdSubdomainField">
      <label for="externalIdSubdomain">Tenant subdomain</label>
      <div class="hint">The subdomain part of the External ID login endpoint — e.g. "contoso" for https://contoso.ciamlogin.com/&lt;tenant-id&gt;/v2.0.</div>
      <input type="text" id="externalIdSubdomain" name="externalIdSubdomain" value="${escapeHtml(editing?.externalIdSubdomain ?? '')}" />
      <div class="error" id="externalIdSubdomainError"></div>
    </div>

    <div class="field${isExternalId ? ' hidden' : ''}" id="cloudField">
      <label for="cloud">Cloud</label>
      <select id="cloud" name="cloud">
        <option value="public" ${selectedAttr(editing?.cloud, 'public')}>Public — login.microsoftonline.com</option>
        <option value="usGov" ${selectedAttr(editing?.cloud, 'usGov')}>US Government — login.microsoftonline.us</option>
        <option value="china" ${selectedAttr(editing?.cloud, 'china')}>China (21Vianet) — login.partner.microsoftonline.cn</option>
      </select>
    </div>

    <label for="clientId">Application (client) ID override (optional)</label>
    <div class="hint">The App Registration's Application (client) ID — not the Object ID of its Enterprise Application/Service Principal. Leave blank to use the "entra.clientId" setting.</div>
    <input type="text" id="clientId" name="clientId" value="${escapeHtml(editing?.clientId ?? '')}" />
    <div class="error" id="clientIdError"></div>

    <hr />

    <label>Authentication method</label>
    <div class="hint">How this connection signs in — a user interactively, or the Enterprise Application itself with no user involved.</div>
    <div class="radio-group">
      <label><input type="radio" name="authMethod" value="delegated" ${authMethodCheckedAttr(authMethod, 'delegated')} /> Delegated sign-in (interactive / device code)</label>
      <label><input type="radio" name="authMethod" value="clientSecret" ${authMethodCheckedAttr(authMethod, 'clientSecret')} /> Client secret (app-only)</label>
      <label><input type="radio" name="authMethod" value="clientCertificate" ${authMethodCheckedAttr(authMethod, 'clientCertificate')} /> Client certificate (app-only)</label>
    </div>

    <div class="field${authMethod === 'clientSecret' ? '' : ' hidden'}" id="clientSecretField">
      <label for="clientSecret">Client secret</label>
      <div class="hint" id="clientSecretHint">${clientSecretHint}</div>
      <input type="password" id="clientSecret" name="clientSecret" autocomplete="off" />
      <div class="error" id="clientSecretError"></div>
    </div>

    <div class="field${authMethod === 'clientCertificate' ? '' : ' hidden'}" id="clientCertificateFields">
      <label for="certificateThumbprint">Certificate thumbprint</label>
      <div class="hint">The certificate's SHA-1 or SHA-256 thumbprint, as shown in the App Registration's "Certificates &amp; secrets" page.</div>
      <input type="text" id="certificateThumbprint" name="certificateThumbprint" value="${escapeHtml(editing?.certificateThumbprint ?? '')}" />
      <div class="error" id="certificateThumbprintError"></div>

      <label for="certificateKey">Certificate private key (PEM)</label>
      <div class="hint" id="certificateKeyHint">${certificateKeyHint}</div>
      <textarea id="certificateKey" name="certificateKey" autocomplete="off" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
      <div class="error" id="certificateKeyError"></div>
    </div>

    <div class="error" id="generalError"></div>

    <div class="actions">
      <button type="submit" class="primary">${editing ? 'Save' : 'Add'}</button>
      <button type="button" class="secondary" id="cancelBtn">Cancel</button>
    </div>
  </form>

<script nonce="${nonce}">
  (function () {
    const vscode = acquireVsCodeApi();
    const otherNames = ${otherNamesJson};
    const credentialState = ${credentialStateJson};
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const thumbprintPattern = /^([0-9a-f]{40}|[0-9a-f]{64})$/i;

    const form = document.getElementById('form');
    const nameInput = document.getElementById('name');
    const tenantKindInputs = document.getElementsByName('tenantKind');
    const authMethodInputs = document.getElementsByName('authMethod');
    const tenantIdInput = document.getElementById('tenantId');
    const clientIdInput = document.getElementById('clientId');
    const externalIdSubdomainInput = document.getElementById('externalIdSubdomain');
    const externalIdSubdomainField = document.getElementById('externalIdSubdomainField');
    const cloudField = document.getElementById('cloudField');
    const clientSecretInput = document.getElementById('clientSecret');
    const clientSecretField = document.getElementById('clientSecretField');
    const certificateThumbprintInput = document.getElementById('certificateThumbprint');
    const certificateKeyInput = document.getElementById('certificateKey');
    const clientCertificateFields = document.getElementById('clientCertificateFields');

    const nameError = document.getElementById('nameError');
    const tenantIdError = document.getElementById('tenantIdError');
    const clientIdError = document.getElementById('clientIdError');
    const externalIdSubdomainError = document.getElementById('externalIdSubdomainError');
    const clientSecretError = document.getElementById('clientSecretError');
    const certificateThumbprintError = document.getElementById('certificateThumbprintError');
    const certificateKeyError = document.getElementById('certificateKeyError');
    const clashError = document.getElementById('clashError');
    const clashMessage = document.getElementById('clashMessage');
    const generalError = document.getElementById('generalError');

    const INVALID_CLIENT_ID_MESSAGE =
      'Must be a GUID (the Application (client) ID, not the Enterprise Application\\'s Object ID).';
    const MISSING_SUBDOMAIN_MESSAGE = 'Enter the tenant subdomain for this External ID tenant.';
    const MISSING_CLIENT_SECRET_MESSAGE = 'Enter the client secret.';
    const MISSING_THUMBPRINT_MESSAGE = 'Enter the certificate thumbprint.';
    const INVALID_THUMBPRINT_MESSAGE = 'Must be a 40-character (SHA-1) or 64-character (SHA-256) hex thumbprint.';
    const MISSING_CERTIFICATE_KEY_MESSAGE = 'Paste the certificate\\'s private key.';

    function currentRadioValue(inputs, fallback) {
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].checked) {
          return inputs[i].value;
        }
      }
      return fallback;
    }

    function currentTenantKind() {
      return currentRadioValue(tenantKindInputs, 'workforce');
    }

    function currentAuthMethod() {
      return currentRadioValue(authMethodInputs, 'delegated');
    }

    function updateTenantKindFields() {
      const isExternalId = currentTenantKind() === 'externalId';
      externalIdSubdomainField.classList.toggle('hidden', !isExternalId);
      cloudField.classList.toggle('hidden', isExternalId);
      if (!isExternalId) {
        externalIdSubdomainError.classList.remove('visible');
      }
    }

    function updateAuthMethodFields() {
      const method = currentAuthMethod();
      clientSecretField.classList.toggle('hidden', method !== 'clientSecret');
      clientCertificateFields.classList.toggle('hidden', method !== 'clientCertificate');
      if (method !== 'clientSecret') {
        clientSecretError.classList.remove('visible');
      }
      if (method !== 'clientCertificate') {
        certificateThumbprintError.classList.remove('visible');
        certificateKeyError.classList.remove('visible');
      }
    }

    for (let i = 0; i < tenantKindInputs.length; i++) {
      tenantKindInputs[i].addEventListener('change', updateTenantKindFields);
    }
    for (let i = 0; i < authMethodInputs.length; i++) {
      authMethodInputs[i].addEventListener('change', updateAuthMethodFields);
    }

    document.getElementById('cancelBtn').addEventListener('click', function () {
      vscode.postMessage({ type: 'cancel' });
    });

    document.getElementById('editExistingBtn').addEventListener('click', function () {
      vscode.postMessage({ type: 'editExisting', name: nameInput.value.trim() });
    });

    function clearErrors() {
      nameError.classList.remove('visible');
      tenantIdError.classList.remove('visible');
      clientIdError.classList.remove('visible');
      externalIdSubdomainError.classList.remove('visible');
      clientSecretError.classList.remove('visible');
      certificateThumbprintError.classList.remove('visible');
      certificateKeyError.classList.remove('visible');
      clashError.classList.remove('visible');
      generalError.classList.remove('visible');
    }

    // Live A1 check as the user types, ahead of the authoritative check on submit (the
    // connection list could have changed since this form opened).
    nameInput.addEventListener('input', function () {
      const clash = otherNames.indexOf(nameInput.value.trim().toLowerCase()) !== -1;
      clashError.classList.toggle('visible', clash);
      if (clash) {
        clashMessage.textContent = 'A connection named "' + nameInput.value.trim() + '" already exists.';
      }
    });

    clientIdInput.addEventListener('input', function () {
      const value = clientIdInput.value.trim();
      const invalid = value.length > 0 && !guidPattern.test(value);
      clientIdError.classList.toggle('visible', invalid);
      if (invalid) {
        clientIdError.textContent = INVALID_CLIENT_ID_MESSAGE;
      }
    });

    externalIdSubdomainInput.addEventListener('input', function () {
      const missing = currentTenantKind() === 'externalId' && !externalIdSubdomainInput.value.trim();
      externalIdSubdomainError.classList.toggle('visible', missing);
      if (missing) {
        externalIdSubdomainError.textContent = MISSING_SUBDOMAIN_MESSAGE;
      }
    });

    certificateThumbprintInput.addEventListener('input', function () {
      const value = certificateThumbprintInput.value.replace(/[\\s:]/g, '');
      const invalid = value.length > 0 && !thumbprintPattern.test(value);
      certificateThumbprintError.classList.toggle('visible', invalid);
      if (invalid) {
        certificateThumbprintError.textContent = INVALID_THUMBPRINT_MESSAGE;
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();

      const name = nameInput.value.trim();
      const tenantId = tenantIdInput.value.trim();
      const clientId = clientIdInput.value.trim();
      const tenantKind = currentTenantKind();
      const externalIdSubdomain = externalIdSubdomainInput.value.trim();
      const authMethod = currentAuthMethod();
      const clientSecret = clientSecretInput.value.trim();
      const certificateThumbprint = certificateThumbprintInput.value.replace(/[\\s:]/g, '');
      const certificateKey = certificateKeyInput.value.trim();
      let hasError = false;

      if (!name) {
        nameError.textContent = 'Enter a name.';
        nameError.classList.add('visible');
        hasError = true;
      }
      if (!tenantId) {
        tenantIdError.textContent = 'Enter a tenant ID or domain.';
        tenantIdError.classList.add('visible');
        hasError = true;
      }
      if (clientId && !guidPattern.test(clientId)) {
        clientIdError.textContent = INVALID_CLIENT_ID_MESSAGE;
        clientIdError.classList.add('visible');
        hasError = true;
      }
      if (tenantKind === 'externalId' && !externalIdSubdomain) {
        externalIdSubdomainError.textContent = MISSING_SUBDOMAIN_MESSAGE;
        externalIdSubdomainError.classList.add('visible');
        hasError = true;
      }
      if (authMethod === 'clientSecret' && !clientSecret && !credentialState.hasClientSecret) {
        clientSecretError.textContent = MISSING_CLIENT_SECRET_MESSAGE;
        clientSecretError.classList.add('visible');
        hasError = true;
      }
      if (authMethod === 'clientCertificate') {
        if (!certificateThumbprint) {
          certificateThumbprintError.textContent = MISSING_THUMBPRINT_MESSAGE;
          certificateThumbprintError.classList.add('visible');
          hasError = true;
        } else if (!thumbprintPattern.test(certificateThumbprint)) {
          certificateThumbprintError.textContent = INVALID_THUMBPRINT_MESSAGE;
          certificateThumbprintError.classList.add('visible');
          hasError = true;
        }
        if (!certificateKey && !credentialState.hasCertificateKey) {
          certificateKeyError.textContent = MISSING_CERTIFICATE_KEY_MESSAGE;
          certificateKeyError.classList.add('visible');
          hasError = true;
        }
      }
      if (hasError) {
        return;
      }

      vscode.postMessage({
        type: 'submit',
        connection: {
          name: name,
          tenantId: tenantId,
          cloud: document.getElementById('cloud').value,
          clientId: clientId,
          tenantKind: tenantKind,
          externalIdSubdomain: externalIdSubdomain,
          authMethod: authMethod,
          clientSecret: clientSecret,
          certificateThumbprint: certificateThumbprint,
          certificateKey: certificateKey,
        },
      });
    });

    window.addEventListener('message', function (event) {
      const message = event.data;
      if (message.type === 'clash') {
        clashMessage.textContent = 'A connection named "' + message.name + '" already exists.';
        clashError.classList.add('visible');
      } else if (message.type === 'invalidClientId') {
        clientIdError.textContent = INVALID_CLIENT_ID_MESSAGE;
        clientIdError.classList.add('visible');
      } else if (message.type === 'missingExternalIdSubdomain') {
        externalIdSubdomainError.textContent = MISSING_SUBDOMAIN_MESSAGE;
        externalIdSubdomainError.classList.add('visible');
      } else if (message.type === 'missingClientSecret') {
        clientSecretError.textContent = MISSING_CLIENT_SECRET_MESSAGE;
        clientSecretError.classList.add('visible');
      } else if (message.type === 'missingCertificateThumbprint') {
        certificateThumbprintError.textContent = MISSING_THUMBPRINT_MESSAGE;
        certificateThumbprintError.classList.add('visible');
      } else if (message.type === 'invalidCertificateThumbprint') {
        certificateThumbprintError.textContent = INVALID_THUMBPRINT_MESSAGE;
        certificateThumbprintError.classList.add('visible');
      } else if (message.type === 'missingCertificateKey') {
        certificateKeyError.textContent = MISSING_CERTIFICATE_KEY_MESSAGE;
        certificateKeyError.classList.add('visible');
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
