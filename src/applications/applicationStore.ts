import * as vscode from 'vscode';
import * as YAML from 'yaml';
import {
  ApplicationFiles,
  emptyAppConfig,
  emptyApplicationFields,
  emptyServicePrincipalFields,
  normalizeAppConfig,
  normalizeApplicationFields,
  normalizeFederatedCredentials,
  normalizeServicePrincipalFields,
  serializeApplication,
  serializeServicePrincipal,
  buildAppConfigNode,
} from './types';

const APP_CONFIG_FILE = 'AppConfig.yaml';
const APPLICATION_TEMPLATE_FILE = 'Application.yaml.j2';
const FEDERATED_CREDENTIALS_TEMPLATE_FILE = 'FederatedCredentials.yaml.j2';
const SERVICE_PRINCIPAL_TEMPLATE_FILE = 'ServicePrincipal.yaml.j2';

async function readYamlOrDefault<T>(uri: vscode.Uri, normalize: (parsed: unknown) => T, fallback: () => T): Promise<T> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    // `merge: true` resolves a `<<: *Anchor` YAML merge key (see AppConfig.yaml's per-environment
    // `Variables`, UC040) into real, flattened entries — without it, `<<` would parse as a literal
    // (and useless) map key. Harmless for the other three files, which never use merge keys.
    return normalize(YAML.parse(Buffer.from(bytes).toString('utf8'), { merge: true }));
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
      return fallback();
    }
    throw err;
  }
}

/**
 * Loads/saves one application's four files (UC040) as a unit, for the structured webview (UC042).
 * All four are parsed/serialized as YAML — see UC042's documented, accepted limitation: hand-written
 * comments, and any fields this schema doesn't model (e.g. an `Application.yaml.j2` key like
 * `implicitGrantSettings`), are lost on save, since each file is parsed to a plain object and
 * re-stringified fresh rather than edited in place. Accepted deliberately — see UC042 — rather than
 * solved with a comment-preserving CST edit, which would be considerably more complex for
 * comparatively little value given these files are expected to be reviewed via `git diff` on commit
 * anyway. `AppConfig.yaml`'s `Variables: &DefaultVariables` / per-environment
 * `<<: *DefaultVariables` merge key is the one exception that *is* preserved, via
 * `buildAppConfigNode()` — see its own doc comment in `types.ts`.
 */
export class ApplicationStore {
  async load(folderUri: vscode.Uri): Promise<ApplicationFiles> {
    const [appConfig, application, federatedCredentials, servicePrincipal] = await Promise.all([
      readYamlOrDefault(vscode.Uri.joinPath(folderUri, APP_CONFIG_FILE), normalizeAppConfig, emptyAppConfig),
      readYamlOrDefault(
        vscode.Uri.joinPath(folderUri, APPLICATION_TEMPLATE_FILE),
        normalizeApplicationFields,
        emptyApplicationFields
      ),
      readYamlOrDefault(
        vscode.Uri.joinPath(folderUri, FEDERATED_CREDENTIALS_TEMPLATE_FILE),
        normalizeFederatedCredentials,
        () => []
      ),
      readYamlOrDefault(
        vscode.Uri.joinPath(folderUri, SERVICE_PRINCIPAL_TEMPLATE_FILE),
        normalizeServicePrincipalFields,
        emptyServicePrincipalFields
      ),
    ]);

    return { appConfig, application, federatedCredentials, servicePrincipal };
  }

  /**
   * Which of the three `.yaml.j2` template files already exist on disk — used by the tenant
   * application "download" flow (UC035) to decide whether it's safe to write a file (create it
   * only if missing) versus needing to leave a hand-authored template (with real Nunjucks
   * placeholders) alone.
   */
  async existingTemplateFiles(
    folderUri: vscode.Uri
  ): Promise<{ application: boolean; federatedCredentials: boolean; servicePrincipal: boolean }> {
    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(folderUri);
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        entries = [];
      } else {
        throw err;
      }
    }
    const names = new Set(entries.map(([name]) => name));
    return {
      application: names.has(APPLICATION_TEMPLATE_FILE),
      federatedCredentials: names.has(FEDERATED_CREDENTIALS_TEMPLATE_FILE),
      servicePrincipal: names.has(SERVICE_PRINCIPAL_TEMPLATE_FILE),
    };
  }

  async save(folderUri: vscode.Uri, files: ApplicationFiles): Promise<void> {
    await vscode.workspace.fs.createDirectory(folderUri);
    const appConfigDoc = new YAML.Document();
    appConfigDoc.contents = buildAppConfigNode(appConfigDoc, files.appConfig);
    await Promise.all([
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folderUri, APP_CONFIG_FILE),
        Buffer.from(appConfigDoc.toString(), 'utf8')
      ),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folderUri, APPLICATION_TEMPLATE_FILE),
        Buffer.from(YAML.stringify(serializeApplication(files.application)), 'utf8')
      ),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folderUri, FEDERATED_CREDENTIALS_TEMPLATE_FILE),
        Buffer.from(YAML.stringify(files.federatedCredentials), 'utf8')
      ),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(folderUri, SERVICE_PRINCIPAL_TEMPLATE_FILE),
        Buffer.from(YAML.stringify(serializeServicePrincipal(files.servicePrincipal)), 'utf8')
      ),
    ]);
  }
}
