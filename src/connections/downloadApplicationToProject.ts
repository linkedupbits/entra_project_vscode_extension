import * as vscode from 'vscode';
import { ApplicationStore } from '../applications/applicationStore';
import { ApplicationFiles } from '../applications/types';
import { getApplicationsRootUri } from '../workspacePaths';
import { TenantApplicationIdentity } from './tenantApplicationIdentity';
import { ApplicationPreviewData } from './tenantApplicationPreview';

export type DownloadApplicationResult =
  | { kind: 'ok'; folderUri: vscode.Uri }
  | { kind: 'noWorkspace' }
  | { kind: 'incompletePreview' };

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
 * - `AppConfig.yaml`'s `business_unit` is filled in only if currently blank.
 * - An `Environments` entry for `identity.environment` is added only if none with that
 *   `environment_code` already exists; an existing one is left untouched.
 * - Each of the three `.yaml.j2` template files is written only if it doesn't already exist
 *   (`ApplicationStore.existingTemplateFiles()`); one already present is never touched.
 *
 * Requires every section of `data` to have loaded successfully — if any of the three Graph calls
 * UC034 makes failed, there is nothing trustworthy to write for that section, so this refuses to
 * write a misleadingly-empty file for it and reports `incompletePreview` instead.
 */
export async function downloadApplicationToProject(
  store: ApplicationStore,
  identity: TenantApplicationIdentity,
  data: ApplicationPreviewData
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

  const hasEnvironment = existing.appConfig.Environments.some((e) => e.environment_code === identity.environment);
  const environments = hasEnvironment
    ? existing.appConfig.Environments
    : [
        ...existing.appConfig.Environments,
        { name: identity.environment, publisherDomain: '', tenancy_type: '', environment_code: identity.environment },
      ];

  const files: ApplicationFiles = {
    appConfig: {
      ...existing.appConfig,
      application_name: existing.appConfig.application_name || identity.appName,
      business_unit: existing.appConfig.business_unit || identity.businessUnit,
      Environments: environments,
    },
    application: existingTemplates.application ? existing.application : data.application.value,
    federatedCredentials: existingTemplates.federatedCredentials
      ? existing.federatedCredentials
      : data.federatedCredentials.value,
    servicePrincipal: existingTemplates.servicePrincipal ? existing.servicePrincipal : data.servicePrincipal.value,
  };

  await store.save(folderUri, files);
  return { kind: 'ok', folderUri };
}
