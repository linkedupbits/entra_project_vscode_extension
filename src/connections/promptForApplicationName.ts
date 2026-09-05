import * as vscode from 'vscode';

/**
 * UC035 A4 — the fallback when `parseTenantApplicationIdentity()` finds no usable `AppName:` tag
 * on the previewed application's Service Principal: rather than refusing to download, ask the
 * user directly which application name — i.e. which `<artifactsRoot>/applications/<name>/`
 * folder — to save it under. Only `appName` is collected here; `downloadApplicationToProject()`
 * has no environment/business unit to work with in this path and simply skips the AppConfig.yaml
 * merge steps that would otherwise use them, rather than this wizard guessing at values for a
 * live tenant's actual environment or business unit.
 *
 * Returns undefined if the user cancels (Esc / focus away) — the same "silently do nothing"
 * convention `resolveConnectionArg.ts` uses for a cancelled prompt, so a cancelled wizard aborts
 * the download without an error notification.
 */
export async function promptForApplicationName(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'Download Application',
    prompt: 'No unique name tag was found on this application. Enter the application name to save it as.',
    placeHolder: 'e.g. sample-web-app',
    validateInput: (input) => (input.trim().length === 0 ? 'Enter an application name.' : undefined),
  });
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
