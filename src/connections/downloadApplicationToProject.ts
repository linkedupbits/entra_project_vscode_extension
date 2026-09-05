import * as vscode from 'vscode';
import { ApplicationStore } from '../applications/applicationStore';
import { ApplicationFiles, ServicePrincipalFields } from '../applications/types';
import { reservedTagPrefixFor } from '../applications/applicationFormLogic';
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
 * (`<artifactsRoot>/applications/<appName>/`), rather than a flat downloaded-artifact snapshot
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
 *   otherwise left blank, the previous behavior.
 * - Each of the three `.yaml.j2` template files is written only if it doesn't already exist
 *   (`ApplicationStore.existingTemplateFiles()`); one already present is never touched. The
 *   Service Principal's tags are filtered (`stripGeneratedTags()`) before being written, so the
 *   four tags UC042 generates automatically are never captured as if they were custom ones.
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
          },
        ];

  const servicePrincipal: ServicePrincipalFields = {
    ...data.servicePrincipal.value,
    tags: stripGeneratedTags(data.servicePrincipal.value.tags, identity.appName),
  };

  const files: ApplicationFiles = {
    appConfig: {
      ...existing.appConfig,
      application_name: existing.appConfig.application_name || identity.appName,
      business_unit: existing.appConfig.business_unit || identity.businessUnit || '',
      Environments: environments,
    },
    application: existingTemplates.application ? existing.application : data.application.value,
    federatedCredentials: existingTemplates.federatedCredentials
      ? existing.federatedCredentials
      : data.federatedCredentials.value,
    servicePrincipal: existingTemplates.servicePrincipal ? existing.servicePrincipal : servicePrincipal,
  };

  await store.save(folderUri, files);
  return { kind: 'ok', folderUri };
}
