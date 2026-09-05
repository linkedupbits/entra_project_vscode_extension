import * as vscode from 'vscode';

/**
 * UC032/UC034 — a read-only webview shell showing one live Graph artifact's contents. It is a
 * viewer, not an editor: no scripts, no message-passing, no path back to the tenant or to a local
 * file, per UC032's "read-only by construction" requirement. One panel per `key` (currently
 * `<connection name>::<object id>` — see UC034) — showing an already-open key again reveals and
 * refreshes that panel instead of opening a duplicate, the same pattern ApplicationFormPanel uses
 * for application folders.
 *
 * `bodyHtml` is caller-supplied content (see UC034's `buildApplicationPreviewHtml`) rendered
 * inside this shell's title/badge/hint chrome — this class owns only the chrome and the shared
 * read-only styling, not any particular artifact type's field layout, so future artifact types
 * can reuse it with their own body content.
 *
 * Deliberately scoped for now to what UC034 needs: no "Compare with local file" action (UC032
 * A1), no "Download" action (UC031) — neither exists yet to link to.
 */
export class ArtifactViewerPanel {
  private static readonly openPanels = new Map<string, ArtifactViewerPanel>();

  private readonly panel: vscode.WebviewPanel;

  static show(key: string, title: string, sourceBadge: string, bodyHtml: string): void {
    const existing = ArtifactViewerPanel.openPanels.get(key);
    if (existing) {
      existing.update(title, sourceBadge, bodyHtml);
      existing.panel.reveal();
      return;
    }
    const created = new ArtifactViewerPanel(key, title, sourceBadge, bodyHtml);
    ArtifactViewerPanel.openPanels.set(key, created);
  }

  private constructor(
    private readonly key: string,
    title: string,
    sourceBadge: string,
    bodyHtml: string
  ) {
    this.panel = vscode.window.createWebviewPanel('entra.artifactViewer', title, vscode.ViewColumn.Active, {});
    this.panel.onDidDispose(() => ArtifactViewerPanel.openPanels.delete(this.key));
    this.update(title, sourceBadge, bodyHtml);
  }

  private update(title: string, sourceBadge: string, bodyHtml: string): void {
    this.panel.title = title;
    this.panel.webview.html = getHtml(title, sourceBadge, bodyHtml);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getHtml(title: string, sourceBadge: string, bodyHtml: string): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline';";

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
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="badge">${escapeHtml(sourceBadge)}</div>
  <div class="hint">Read-only preview of the live Microsoft Graph object — not a local file, and nothing here is saved.</div>
  ${bodyHtml}
</body>
</html>`;
}
