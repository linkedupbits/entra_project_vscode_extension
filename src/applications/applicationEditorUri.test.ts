import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import {
  APPLICATION_EDITOR_SCHEME,
  toApplicationEditorUri,
  fromApplicationEditorUri,
} from './applicationEditorUri';

describe('applicationEditorUri', () => {
  it('round-trips the real application folder URI through the query string', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/applications/sample-web-app') as unknown as vscode.Uri;

    const editorUri = toApplicationEditorUri(folderUri);
    const recovered = fromApplicationEditorUri(editorUri);

    expect(recovered.toString()).toBe(folderUri.toString());
  });

  it('uses the entra-application-editor scheme', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/applications/sample-web-app') as unknown as vscode.Uri;

    const editorUri = toApplicationEditorUri(folderUri);

    expect(editorUri.scheme).toBe(APPLICATION_EDITOR_SCHEME);
    expect(APPLICATION_EDITOR_SCHEME).toBe('entra-application-editor');
  });

  it("uses the plain application name — not the encoded folder URI — as the URI's path, so the tab title reads as just the application name", () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/applications/sample-web-app') as unknown as vscode.Uri;

    const editorUri = toApplicationEditorUri(folderUri);

    expect(editorUri.path).toBe('/sample-web-app');
    expect(editorUri.path).not.toContain('%');
  });

  it('round-trips an application name containing characters that need encoding', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/applications/My App (v2)') as unknown as vscode.Uri;

    const editorUri = toApplicationEditorUri(folderUri);
    const recovered = fromApplicationEditorUri(editorUri);

    expect(recovered.toString()).toBe(folderUri.toString());
  });
});
