import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { APPLICATION_DOCUMENT_SCHEME, toApplicationDocumentUri, fromApplicationDocumentUri } from './applicationDocumentUri';

describe('toApplicationDocumentUri / fromApplicationDocumentUri', () => {
  it('round-trips a folder URI through the virtual document URI', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/Applications/sample-web-app') as unknown as vscode.Uri;

    const documentUri = toApplicationDocumentUri(folderUri);
    const recovered = fromApplicationDocumentUri(documentUri);

    expect(recovered.toString()).toBe(folderUri.toString());
  });

  it('uses the entra-application scheme', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/Applications/sample-web-app') as unknown as vscode.Uri;

    const documentUri = toApplicationDocumentUri(folderUri);

    expect(documentUri.scheme).toBe(APPLICATION_DOCUMENT_SCHEME);
    expect(documentUri.scheme).toBe('entra-application');
  });

  it('gives the virtual document a .yaml path suffix, for syntax highlighting', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/Applications/sample-web-app') as unknown as vscode.Uri;

    const documentUri = toApplicationDocumentUri(folderUri);

    expect(documentUri.path.endsWith('.yaml')).toBe(true);
  });

  it('round-trips correctly even when the folder path contains characters needing encoding', () => {
    const folderUri = vscode.Uri.parse('file:///repo/entra/Applications/sample app (dev)') as unknown as vscode.Uri;

    const documentUri = toApplicationDocumentUri(folderUri);
    const recovered = fromApplicationDocumentUri(documentUri);

    expect(recovered.toString()).toBe(folderUri.toString());
  });
});
