import * as vscode from 'vscode';
import { isValidApplicationName } from './createApplication';

/**
 * UC043 — asks for the name of a new project application (its `<artifactsRoot>/Applications/<name>/`
 * folder). Rejects a blank name, one containing a path separator, and one that collides with an
 * existing application in `existingNames`. Returns the trimmed name, or undefined if the user
 * cancels (Esc / focus away) — the same "silently do nothing" convention the other prompt
 * wrappers use.
 */
export async function promptForNewApplicationName(existingNames: readonly string[]): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: 'New Application',
    prompt: "Name for the new application definition — its folder under Applications/.",
    placeHolder: 'e.g. sample-web-app',
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        return 'Enter an application name.';
      }
      if (!isValidApplicationName(trimmed)) {
        return 'An application name cannot be "." or ".." or contain "/" or "\\".';
      }
      if (existingNames.includes(trimmed)) {
        return `An application named "${trimmed}" already exists.`;
      }
      return undefined;
    },
  });
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
