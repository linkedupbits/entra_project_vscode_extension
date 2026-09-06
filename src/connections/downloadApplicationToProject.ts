import * as vscode from 'vscode';
import { ApplicationStore } from '../applications/applicationStore';
import {
  ApplicationFields,
  ApplicationFiles,
  ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS,
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
 * - An `Environments` entry for `identity.environment` is added only if none with that
 *   `environment_code` already exists; an existing one is left untouched. Skipped entirely if
 *   `identity.environment` is absent (UC035 A4's fallback wizard never collects one). When adding
 *   one, `publisherDomain`/`tenancy_type` are filled in from `connection`/the fetched application
 *   only if the Service Principal also carries a separate `Environment:` tag (see UC035 A5) —
 *   otherwise left blank, the previous behavior. The tenant application's redirect URIs are seeded
 *   into the new entry's `Variables` (as `web_redirectUris` / `publicClient_redirectURIs` /
 *   `spa_redirectURIs` arrays — UC042 models redirect URIs per environment), each omitted if empty.
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
  const hasEnvironment =
    !environment || existing.appConfig.Environments.some((e) => e.environment_code === environment);
  const enrichFromConnection = hasEnvironmentTag(data.servicePrincipal.value.tags);
  const newEnvironmentVariables: Record<string, string | string[]> = {};
  if (data.webRedirectUris.length > 0) {
    newEnvironmentVariables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.web] = data.webRedirectUris;
  }
  if (data.publicClientRedirectUris.length > 0) {
    newEnvironmentVariables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.publicClient] = data.publicClientRedirectUris;
  }
  if (data.spaRedirectUris.length > 0) {
    newEnvironmentVariables[ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS.spa] = data.spaRedirectUris;
  }
  const environments =
    !environment || hasEnvironment
      ? existing.appConfig.Environments
      : [
          ...existing.appConfig.Environments,
          {
            name: environment,
            publisherDomain: enrichFromConnection ? data.applicationPublisherDomain : '',
            tenancy_type: enrichFromConnection ? tenancyTypeFor(connection) : '',
            environment_code: environment,
            Variables: newEnvironmentVariables,
          },
        ];

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
