import * as vscode from 'vscode';
import * as crypto from 'crypto';

interface DownloadMessage {
  type: 'download';
}

/**
 * UC032/UC034/UC035 — a read-only webview shell showing one live Graph artifact's contents, plus
 * an optional "Download" action (UC035). It is a viewer, not an editor: the body itself has no
 * inputs and no way to change what's on the tenant or in a local file — the one interactive
 * element this shell adds, the Download button, only exists when the caller supplies an
 * `onDownload` callback, and firing it is the caller's decision entirely (this class just relays
 * the click). One panel per `key` (currently `<connection name>::<object id>` — see UC034) —
 * showing an already-open key again reveals and refreshes that panel instead of opening a
 * duplicate — UC042's `ApplicationEditorProvider` gets the equivalent behavior for free from VS
 * Code's own Custom Editor document model instead of implementing it by hand like this class does.
 *
 * `bodyHtml` is caller-supplied content (see UC034's `buildApplicationPreviewHtml`) rendered
 * inside this shell's title/badge/hint/download chrome — this class owns only the chrome and the
 * shared read-only styling, not any particular artifact type's field layout, so future artifact
 * types can reuse it with their own body content.
 *
 * Deliberately scoped for now to what UC034/UC035 need: no "Compare with local file" action
 * (UC032 A1) — that doesn't exist yet to link to.
 */
export class ArtifactViewerPanel {
  private static readonly openPanels = new Map<string, ArtifactViewerPanel>();

  private readonly panel: vscode.WebviewPanel;
  private onDownload: (() => void | Promise<void>) | undefined;

  static show(
    key: string,
    title: string,
    sourceBadge: string,
    bodyHtml: string,
    onDownload?: () => void | Promise<void>
  ): void {
    const existing = ArtifactViewerPanel.openPanels.get(key);
    if (existing) {
      existing.update(title, sourceBadge, bodyHtml, onDownload);
      existing.panel.reveal();
      return;
    }
    const created = new ArtifactViewerPanel(key, title, sourceBadge, bodyHtml, onDownload);
    ArtifactViewerPanel.openPanels.set(key, created);
  }

  private constructor(
    private readonly key: string,
    title: string,
    sourceBadge: string,
    bodyHtml: string,
    onDownload: (() => void | Promise<void>) | undefined
  ) {
    this.panel = vscode.window.createWebviewPanel('entra.artifactViewer', title, vscode.ViewColumn.Active, {
      enableScripts: true,
    });
    this.panel.onDidDispose(() => ArtifactViewerPanel.openPanels.delete(this.key));
    this.panel.webview.onDidReceiveMessage((message: DownloadMessage) => {
      if (message.type === 'download' && this.onDownload) {
        void this.onDownload();
      }
    });
    this.update(title, sourceBadge, bodyHtml, onDownload);
  }

  private update(
    title: string,
    sourceBadge: string,
    bodyHtml: string,
    onDownload: (() => void | Promise<void>) | undefined
  ): void {
    this.onDownload = onDownload;
    this.panel.title = title;
    this.panel.webview.html = getHtml(title, sourceBadge, bodyHtml, onDownload !== undefined);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

function getHtml(title: string, sourceBadge: string, bodyHtml: string, showDownloadButton: boolean): string {
  const nonce = getNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 24px;
    max-width: 860px;
  }
  h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 8px; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 24px 0 8px; }
  h3 { font-size: 0.95em; font-weight: 600; margin: 16px 0 4px; color: var(--vscode-descriptionForeground); }
  .top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .badge {
    display: inline-block;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 2px;
    padding: 2px 8px;
    font-size: 0.85em;
    margin-bottom: 16px;
  }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 16px; }
  label { display: block; margin-top: 12px; font-weight: 600; }
  .value { margin-top: 2px; }
  .unique-name {
    margin-top: 2px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  ul { margin: 4px 0; padding-left: 20px; }
  code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .fedcred-card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 10px 12px;
    margin: 6px 0;
  }
  .error {
    color: var(--vscode-errorForeground);
    font-size: 0.9em;
    margin-top: 4px;
  }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 16px;
    border-radius: 4px;
    overflow: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
    white-space: pre-wrap;
    word-break: break-word;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 1em;
    font-family: inherit;
    flex: 0 0 auto;
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.primary:disabled { opacity: 0.6; cursor: default; }
</style>
</head>
<body>
  <div class="top-row">
    <h1>${escapeHtml(title)}</h1>
    ${showDownloadButton ? '<button type="button" class="primary" id="downloadBtn">Download to project</button>' : ''}
  </div>
  <div class="badge">${escapeHtml(sourceBadge)}</div>
  <div class="hint">Read-only preview of the live Microsoft Graph object — not a local file, and nothing here is saved.</div>
  ${bodyHtml}

${
  showDownloadButton
    ? `<script nonce="${nonce}">
  (function () {
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById('downloadBtn');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Downloading…';
      vscode.postMessage({ type: 'download' });
    });
  })();
</script>`
    : ''
}
</body>
</html>`;
}
