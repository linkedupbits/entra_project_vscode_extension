import * as vscode from 'vscode';
import { getApplicationsRootUri } from '../workspacePaths';
import { ApplicationStore } from './applicationStore';
import { emptyAppConfig, emptyApplicationFields, emptyServicePrincipalFields } from './types';

export type CreateApplicationResult =
  | { kind: 'ok'; folderUri: vscode.Uri; name: string }
  | { kind: 'noWorkspace' }
  | { kind: 'invalidName' }
  | { kind: 'alreadyExists' };

/** Whether `name` is usable as an `<artifactsRoot>/Applications/<name>/` folder name (a single path segment). */
export function isValidApplicationName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed !== '.' && trimmed !== '..' && !/[/\\]/.test(trimmed);
}

/**
 * UC043 — creates a new, empty application definition folder `<artifactsRoot>/Applications/<name>/`
 * with the four files UC040 defines: `AppConfig.yaml` carrying just `application_name`, and the
 * three `.yaml.j2` templates at their empty defaults (blank display name, `AzureADMyOrg` audience,
 * no permissions/scopes/credentials/tags, plus the generated redirect-URI blocks). Written through
 * `ApplicationStore.save()` so the files get exactly the shape a subsequent UC042 Save would
 * produce. Refuses if the name isn't a usable single path segment, or a folder with that name is
 * already listed in `existingNames`.
 */
export async function createApplication(
  store: ApplicationStore,
  existingNames: readonly string[],
  name: string
): Promise<CreateApplicationResult> {
  const trimmed = name.trim();
  if (!isValidApplicationName(trimmed)) {
    return { kind: 'invalidName' };
  }
  const root = getApplicationsRootUri();
  if (!root) {
    return { kind: 'noWorkspace' };
  }
  if (existingNames.includes(trimmed)) {
    return { kind: 'alreadyExists' };
  }
  const folderUri = vscode.Uri.joinPath(root, trimmed);
  await store.save(folderUri, {
    appConfig: { ...emptyAppConfig(), application_name: trimmed },
    application: emptyApplicationFields(),
    federatedCredentials: [],
    servicePrincipal: emptyServicePrincipalFields(),
  });
  return { kind: 'ok', folderUri, name: trimmed };
}
