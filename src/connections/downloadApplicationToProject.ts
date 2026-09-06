import * as vscode from 'vscode';
import { ApplicationStore } from '../applications/applicationStore';
import {
  ApplicationFields,
  ApplicationFiles,
  ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS,
  EnvironmentEntry,
  ServicePrincipalFields,
} from '../applications/types';
import { reservedTagPrefixFor } from '../applications/applicationFormLogic';
import { deriveApplicationDependencies } from './applicationDependencies';
import { getApplicationsRootUri } from '../workspacePaths';
import { Connection } from './types';
import { ApplicationDownloadTarget, hasEnvironmentTag } from './tenantApplicationIdentity';
import { ApplicationPreviewData } from './tenantApplicationPreview';

export type DownloadApplicationResult =
  | { kind: 'ok'; folderUri: vscode.Uri }
  | { kind: 'noWorkspace' }
  | { kind: 'incompletePreview' };

/** Workforce/CIAM, drawn from the connection actually used to fetch this data — see UC035 A5. */
function tenancyTypeFor(connection: Connection): string {
  return connection.tenantKind === 'externalId' ? 'ciam' : 'workforce';
}

/**
 * UC042's Generated tags preview describes four tags a real deploy is expected to apply
 * automatically (`AppName:...`, `Environment:...`, the bare app name, `BusinessUnit:...`) — the
 * structured editor already refuses to let a user hand-type a custom tag with three of those
 * prefixes (see `applicationFormLogic.ts`'s `reservedTagPrefixFor`). A tenant Service Principal's
 * real tags legitimately include all four, but saving them verbatim into `ServicePrincipal.yaml.j2`
 * would immediately fail that very validation the next time the file is opened in UC042 and saved
 * — so they're filtered out here, leaving only genuinely custom tags.
 */
function stripGeneratedTags(tags: readonly string[], appName: string): string[] {
  return tags.filter((tag) => !reservedTagPrefixFor(tag) && tag !== appName);
}

/**
 * The previewed tenant application's redirect URIs as the three `EnvironmentEntry.Variables` array
 * keys UC042 uses — each key omitted entirely when the tenant application has none of that category
 * (matching UC042's "an empty list writes no key").
 */
function redirectUriVariables(data: ApplicationPreviewData): Record<string, string[]> {
  const vars: Record<string, string[]> = {};
  if (data.webRedirectUris.length > 0) {
    vars[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.web] = data.webRedirectUris;
  }
  if (data.publicClientRedirectUris.length > 0) {
    vars[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.publicClient] = data.publicClientRedirectUris;
  }
  if (data.spaRedirectUris.length > 0) {
    vars[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.spa] = data.spaRedirectUris;
  }
  return vars;
}

/**
 * UC035 — `create-or-update` for the one `Environments` entry matching the connected application's
 * environment (matched by `environment_code`):
 * - **create**: append a new entry (`name`/`environment_code` = the environment), its
 *   `publisherDomain`/`tenancy_type` from the connection only if `enrich` (the `Environment:` tag
 *   signal — see UC035 A5), its `Variables` the previewed redirect URIs.
 * - **update**: overwrite that entry's redirect-URI Variables with the previewed ones (a category
 *   the tenant no longer has is *removed*), and — only if `enrich` — its `publisherDomain`/
 *   `tenancy_type`. Every other field (`name`, custom `Variables` keys, per-environment scope-id
 *   variables) is preserved.
 * Environments other than this one are never touched.
 */
function upsertEnvironment(
  existing: readonly EnvironmentEntry[],
  environment: string,
  redirectVariables: Record<string, string[]>,
  enrich: boolean,
  publisherDomain: string,
  tenancyType: string
): EnvironmentEntry[] {
  const redirectKeys = Object.values(ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS) as string[];
  const index = existing.findIndex((entry) => entry.environment_code === environment);

  if (index === -1) {
    return [
      ...existing,
      {
        name: environment,
        publisherDomain: enrich ? publisherDomain : '',
        tenancy_type: enrich ? tenancyType : '',
        environment_code: environment,
        Variables: { ...redirectVariables },
      },
    ];
  }

  return existing.map((entry, i) => {
    if (i !== index) {
      return entry;
    }
    const variables: Record<string, string | string[]> = { ...entry.Variables };
    for (const key of redirectKeys) {
      if (redirectVariables[key]) {
        variables[key] = redirectVariables[key];
      } else {
        delete variables[key];
      }
    }
    return {
      ...entry,
      publisherDomain: enrich ? publisherDomain : entry.publisherDomain,
      tenancy_type: enrich ? tenancyType : entry.tenancy_type,
      Variables: variables,
    };
  });
}

/**
 * UC035 — captures a tenant application's live Application/FederatedCredentials/ServicePrincipal
 * details into the local application-definition folder UC040 already defines for `identity.appName`
 * (`<artifactsRoot>/Applications/<appName>/`), rather than a flat downloaded-artifact snapshot
 * (UC020/UC031) — there is no such snapshot concept for Applications yet, and this folder is the
 * one place this project already models "the local counterpart of a tenant application."
 *
 * Deliberately non-destructive, since a hand-authored `.yaml.j2` template (with real Nunjucks
 * placeholders) must never be silently overwritten with the concrete, resolved values this
 * capture produces:
 * - `AppConfig.yaml`'s `business_unit` is filled in only if currently blank, and only if
 *   `identity.businessUnit` was actually supplied.
 * - The `Environments` entry for `identity.environment` (matched by `environment_code`) is
 *   **created if missing, updated if present** — see `upsertEnvironment()`. Either way its
 *   redirect-URI `Variables` (`web_redirectUris` / `publicClient_redirectURIs` / `spa_redirectURIs`
 *   arrays — UC042 models redirect URIs per environment) are set to the tenant application's
 *   current redirect URIs (a category the tenant no longer has is dropped on update); its
 *   `publisherDomain`/`tenancy_type` are set from `connection`/the fetched application only if the
 *   Service Principal also carries a separate `Environment:` tag (see UC035 A5) — otherwise left
 *   blank on create, or left as-is on update. An existing entry's `name`, its other `Variables`
 *   keys, and every *other* environment are all preserved. Skipped entirely if
 *   `identity.environment` is absent (UC035 A4's fallback wizard never collects one).
 * - Each of the three `.yaml.j2` template files is written only if it doesn't already exist
 *   (`ApplicationStore.existingTemplateFiles()`); one already present is never touched. The
 *   Service Principal's tags are filtered (`stripGeneratedTags()`) before being written, so the
 *   four tags UC042 generates automatically are never captured as if they were custom ones.
 * - When a fresh `Application.yaml.j2` is written, every non-Graph `resourceAppId` in its Required
 *   Permissions is turned into an `AppConfig.yaml` `Dependencies` entry (merged into any already
 *   there) and the permission row is rewritten: its `resourceAppId` becomes
 *   `{{ dependency_refs.<key>.applicationId }}` and its `id` becomes the resolved permission's
 *   value/name instead of the tenant GUID, so UC042's Permission Editor renders it (a dependency
 *   scope is keyed by value, not id — see `deriveApplicationDependencies()`). Microsoft Graph
 *   permissions are left alone. If `Application.yaml.j2` already exists, its permissions and the
 *   existing `Dependencies` map are both left untouched.
 *
 * Requires every section of `data` to have loaded successfully — if any of the three Graph calls
 * UC034 makes failed, there is nothing trustworthy to write for that section, so this refuses to
 * write a misleadingly-empty file for it and reports `incompletePreview` instead.
 */
export async function downloadApplicationToProject(
  store: ApplicationStore,
  identity: ApplicationDownloadTarget,
  data: ApplicationPreviewData,
  connection: Connection
): Promise<DownloadApplicationResult> {
  if (data.application.kind !== 'ok' || data.federatedCredentials.kind !== 'ok' || data.servicePrincipal.kind !== 'ok') {
    return { kind: 'incompletePreview' };
  }

  const root = getApplicationsRootUri();
  if (!root) {
    return { kind: 'noWorkspace' };
  }
  const folderUri = vscode.Uri.joinPath(root, identity.appName);

  const [existing, existingTemplates] = await Promise.all([
    store.load(folderUri),
    store.existingTemplateFiles(folderUri),
  ]);

  const environment = identity.environment;
  const enrichFromConnection = hasEnvironmentTag(data.servicePrincipal.value.tags);
  const environments = environment
    ? upsertEnvironment(
        existing.appConfig.Environments,
        environment,
        redirectUriVariables(data),
        enrichFromConnection,
        data.applicationPublisherDomain,
        tenancyTypeFor(connection)
      )
    : existing.appConfig.Environments;

  const servicePrincipal: ServicePrincipalFields = {
    ...data.servicePrincipal.value,
    tags: stripGeneratedTags(data.servicePrincipal.value.tags, identity.appName),
  };

  // Dependencies on other applications are worked out from the tenant application's Required
  // Permissions — but only when writing a fresh Application.yaml.j2, since rewriting a permission
  // row's resourceAppId to a dependency_refs reference is meaningless without also owning that file.
  const derivedDependencies = existingTemplates.application
    ? undefined
    : deriveApplicationDependencies(
        data.application.value.requiredPermissions,
        data.resourceApplications,
        existing.appConfig.Dependencies
      );

  const applicationFile: ApplicationFields = derivedDependencies
    ? { ...data.application.value, requiredPermissions: derivedDependencies.requiredPermissions }
    : data.application.value;

  const files: ApplicationFiles = {
    appConfig: {
      ...existing.appConfig,
      application_name: existing.appConfig.application_name || identity.appName,
      business_unit: existing.appConfig.business_unit || identity.businessUnit || '',
      Environments: environments,
      Dependencies: derivedDependencies ? derivedDependencies.dependencies : existing.appConfig.Dependencies,
    },
    application: existingTemplates.application ? existing.application : applicationFile,
    federatedCredentials: existingTemplates.federatedCredentials
      ? existing.federatedCredentials
      : data.federatedCredentials.value,
    servicePrincipal: existingTemplates.servicePrincipal ? existing.servicePrincipal : servicePrincipal,
  };

  await store.save(folderUri, files);
  return { kind: 'ok', folderUri };
}
