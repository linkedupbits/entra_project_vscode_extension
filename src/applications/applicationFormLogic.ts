import {
  AppConfig,
  ApplicationFields,
  ApplicationFiles,
  DependencyEntry,
  EnvironmentEntry,
  FederatedCredentialEntry,
  Oauth2PermissionScopeEntry,
  RequiredPermission,
  ServicePrincipalFields,
  SignInAudience,
} from './types';
import * as crypto from 'crypto';
import { buildEnvironmentVariableIdReference, parseEnvironmentVariableIdName } from './oauth2ScopeIdReference';

export interface VariableRowInput {
  key: string;
  value: string;
}

export interface EnvironmentRowInput {
  name: string;
  publisherDomain: string;
  tenancy_type: string;
  environment_code: string;
  /** Carried through unedited by this row's own UI — see EnvironmentEntry.Variables' doc comment. */
  variables: Record<string, string>;
}

/** `appName` is picked from the project's existing application folders, not free text — see ApplicationEditorProvider. */
export interface DependencyRowInput {
  key: string;
  appName: string;
}

export interface RequiredPermissionRowInput {
  resourceAppId: string;
  id: string;
  type: string;
}

/**
 * See Oauth2PermissionScopeEntry — this is its raw, unresolved form as posted from the webview.
 * `id` is the row's fallback id (a random GUID generated when the row was first added, or whatever
 * was already on disk) — used as-is only when `idVariableName` is blank; see
 * resolveOauth2PermissionScopes.
 */
export interface Oauth2PermissionScopeRowInput {
  id: string;
  idVariableName: string;
  value: string;
  type: string;
  adminConsentDisplayName: string;
  adminConsentDescription: string;
  userConsentDisplayName: string;
  userConsentDescription: string;
  isEnabled: boolean;
}

export interface ApplicationFieldsInput {
  displayName: string;
  signInAudience: string;
  redirectUris: string[];
  requiredPermissions: RequiredPermissionRowInput[];
  oauth2PermissionScopes: Oauth2PermissionScopeRowInput[];
}

/** `audiences` arrives as one comma-separated field from the form — see FederatedCredentialEntry's doc comment. */
export interface FederatedCredentialRowInput {
  name: string;
  issuer: string;
  subject: string;
  audiences: string;
  description: string;
}

export interface ServicePrincipalFieldsInput {
  appId: string;
  appRoleAssignmentRequired: boolean;
  tags: string[];
}

export interface ApplicationFormInput {
  application_name: string;
  business_unit: string;
  variables: VariableRowInput[];
  environments: EnvironmentRowInput[];
  dependencies: DependencyRowInput[];
  application: ApplicationFieldsInput;
  federatedCredentials: FederatedCredentialRowInput[];
  servicePrincipal: ServicePrincipalFieldsInput;
}

export type ApplicationSubmitResolution =
  | { kind: 'missingApplicationName' }
  | { kind: 'missingVariableKey' }
  | { kind: 'duplicateVariableKey'; key: string }
  | { kind: 'missingEnvironmentName'; index: number }
  | { kind: 'duplicateEnvironmentName'; name: string }
  | { kind: 'missingDependencyKey' }
  | { kind: 'missingDependencyAppName'; key: string }
  | { kind: 'duplicateDependencyKey'; key: string }
  | { kind: 'reservedTagPrefix'; tag: string; prefix: string }
  | { kind: 'ok'; files: ApplicationFiles };

/**
 * These are the prefixes UC042's Generated tags preview uses (see applicationEditorHtml.ts's
 * `updateGeneratedTags()`) — reserved so a custom tag can never collide with, or be mistaken for,
 * one of those deploy-time-applied tags. Case-sensitive, matching the preview's own casing exactly.
 */
/**
 * Exported so `downloadApplicationToProject.ts` can strip these same generated tags out of a
 * tenant Service Principal's real tags before saving them locally — otherwise a downloaded
 * `ServicePrincipal.yaml.j2` would fail this very validation the next time it's opened in UC042's
 * editor and saved.
 */
export const RESERVED_TAG_PREFIXES: readonly string[] = ['AppName:', 'Environment:', 'BusinessUnit:'];

export function reservedTagPrefixFor(tag: string): string | undefined {
  return RESERVED_TAG_PREFIXES.find((prefix) => tag.startsWith(prefix));
}

const SIGN_IN_AUDIENCES: readonly SignInAudience[] = [
  'AzureADMyOrg',
  'AzureADMultipleOrgs',
  'AzureADandPersonalMicrosoftAccount',
  'PersonalMicrosoftAccount',
];

function coerceSignInAudience(value: string): SignInAudience {
  return (SIGN_IN_AUDIENCES as string[]).includes(value) ? (value as SignInAudience) : 'AzureADMyOrg';
}

function resolveApplication(input: ApplicationFieldsInput): ApplicationFields {
  const redirectUris = input.redirectUris.map((uri) => uri.trim()).filter((uri) => uri.length > 0);

  const requiredPermissions: RequiredPermission[] = [];
  for (const row of input.requiredPermissions) {
    const resourceAppId = row.resourceAppId.trim();
    const id = row.id.trim();
    if (!resourceAppId && !id) {
      continue; // blank spacer row
    }
    requiredPermissions.push({ resourceAppId, id, type: row.type === 'Role' ? 'Role' : 'Scope' });
  }

  return {
    displayName: input.displayName.trim(),
    signInAudience: coerceSignInAudience(input.signInAudience),
    redirectUris,
    requiredPermissions,
    oauth2PermissionScopes: resolveOauth2PermissionScopes(input.oauth2PermissionScopes),
  };
}

/**
 * Same "structural cleanup, not hard validation" treatment as the rest of the Application section
 * (see resolveApplicationSubmit's doc comment) — a row is only dropped as an unused spacer if every
 * user-entered field is blank; `id`/`idVariableName`/`isEnabled` are excluded from that check since
 * a fresh row always carries an auto-generated id and a default-enabled checkbox even before the
 * user has typed anything else into it.
 *
 * `id` resolution: a non-blank `idVariableName` always wins, becoming
 * `{{ environment.Variables.<name> }}` (see oauth2ScopeIdReference.ts) — letting the actual id
 * value be parked per-environment (AppConfig.yaml's Variables, UC040) rather than fixed at
 * authoring time. A blank `idVariableName` falls back to the row's own `id` unchanged, so a raw
 * GUID already on disk (e.g. from a downloaded tenant application) is never silently overwritten
 * just because this field was left empty.
 */
function resolveOauth2PermissionScopes(rows: readonly Oauth2PermissionScopeRowInput[]): Oauth2PermissionScopeEntry[] {
  const entries: Oauth2PermissionScopeEntry[] = [];
  for (const row of rows) {
    const value = row.value.trim();
    const adminConsentDisplayName = row.adminConsentDisplayName.trim();
    const adminConsentDescription = row.adminConsentDescription.trim();
    const userConsentDisplayName = row.userConsentDisplayName.trim();
    const userConsentDescription = row.userConsentDescription.trim();
    if (!value && !adminConsentDisplayName && !adminConsentDescription && !userConsentDisplayName && !userConsentDescription) {
      continue; // blank spacer row
    }
    const idVariableName = row.idVariableName.trim();
    const id = idVariableName ? buildEnvironmentVariableIdReference(idVariableName) : row.id.trim();
    entries.push({
      id,
      value,
      type: row.type === 'Admin' ? 'Admin' : 'User',
      adminConsentDisplayName,
      adminConsentDescription,
      userConsentDisplayName,
      userConsentDescription,
      isEnabled: row.isEnabled,
    });
  }
  return entries;
}

function resolveFederatedCredentials(rows: readonly FederatedCredentialRowInput[]): FederatedCredentialEntry[] {
  const entries: FederatedCredentialEntry[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const issuer = row.issuer.trim();
    const subject = row.subject.trim();
    const description = row.description.trim();
    const audiences = row.audiences
      .split(',')
      .map((audience) => audience.trim())
      .filter((audience) => audience.length > 0);
    if (!name && !issuer && !subject && !description && audiences.length === 0) {
      continue; // blank spacer row
    }
    entries.push({ name, issuer, subject, audiences, description });
  }
  return entries;
}

function resolveServicePrincipal(input: ServicePrincipalFieldsInput): ServicePrincipalFields {
  return {
    appId: input.appId.trim(),
    appRoleAssignmentRequired: input.appRoleAssignmentRequired,
    tags: input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
  };
}

/**
 * UC042's validation: required Application Name; Variables keys must be present and unique (a
 * row that's entirely blank — no key, no value — is a spacer the UI lets you add and is silently
 * dropped, not an error); Environment names must be present and unique; Dependency rows must have
 * both a reference key and a selected application, and reference keys must be unique (same
 * blank-row-as-spacer rule as Variables); a custom Tag must not start with a reserved prefix
 * (`AppName:`, `Environment:`, `BusinessUnit:`) reserved for the Generated tags preview, so a
 * custom tag can never collide with or shadow one applied automatically at deploy time. Everything
 * else (the Application/FederatedCredentials/ServicePrincipal sections) is structural cleanup —
 * trim, drop blank rows, coerce enum-like fields to a valid value — not hard validation, since
 * UC040 never specified stricter rules than "mirror the Graph JSON shape", and inventing them here
 * would be asserting requirements nobody asked for.
 */
export function resolveApplicationSubmit(input: ApplicationFormInput): ApplicationSubmitResolution {
  const applicationName = input.application_name.trim();
  if (!applicationName) {
    return { kind: 'missingApplicationName' };
  }

  const variables: Record<string, string> = {};
  for (const row of input.variables) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) {
      continue;
    }
    if (!key) {
      return { kind: 'missingVariableKey' };
    }
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return { kind: 'duplicateVariableKey', key };
    }
    variables[key] = value;
  }

  const environments: EnvironmentEntry[] = [];
  const seenNames = new Set<string>();
  for (let index = 0; index < input.environments.length; index++) {
    const row = input.environments[index];
    const name = row.name.trim();
    const isBlankRow = !name && !row.publisherDomain.trim() && !row.tenancy_type.trim() && !row.environment_code.trim();
    if (isBlankRow) {
      continue;
    }
    if (!name) {
      return { kind: 'missingEnvironmentName', index };
    }
    if (seenNames.has(name.toLowerCase())) {
      return { kind: 'duplicateEnvironmentName', name };
    }
    seenNames.add(name.toLowerCase());
    environments.push({
      name,
      publisherDomain: row.publisherDomain.trim(),
      tenancy_type: row.tenancy_type.trim(),
      environment_code: row.environment_code.trim(),
      Variables: { ...row.variables },
    });
  }
  mergeDefaultVariablesIntoEnvironments(variables, environments);

  const dependencies: Record<string, DependencyEntry> = {};
  for (const row of input.dependencies) {
    const key = row.key.trim();
    const appName = row.appName.trim();
    if (!key && !appName) {
      continue; // blank spacer row
    }
    if (!key) {
      return { kind: 'missingDependencyKey' };
    }
    if (!appName) {
      return { kind: 'missingDependencyAppName', key };
    }
    if (Object.prototype.hasOwnProperty.call(dependencies, key)) {
      return { kind: 'duplicateDependencyKey', key };
    }
    dependencies[key] = { AppName: appName };
  }

  const appConfig: AppConfig = {
    application_name: applicationName,
    business_unit: input.business_unit.trim(),
    Variables: variables,
    Environments: environments,
    Dependencies: dependencies,
  };

  const servicePrincipal = resolveServicePrincipal(input.servicePrincipal);
  for (const tag of servicePrincipal.tags) {
    const prefix = reservedTagPrefixFor(tag);
    if (prefix) {
      return { kind: 'reservedTagPrefix', tag, prefix };
    }
  }

  const application = resolveApplication(input.application);
  ensureOauth2ScopeIdVariablesInEnvironments(application.oauth2PermissionScopes, environments);

  return {
    kind: 'ok',
    files: {
      appConfig,
      application,
      federatedCredentials: resolveFederatedCredentials(input.federatedCredentials),
      servicePrincipal,
    },
  };
}

/**
 * `AppConfig.yaml`'s shared, top-level `Variables` are meant to be visible from every environment's
 * own `Variables` map too (see `Example_Project`'s `AppConfig.yaml`, which expresses this with a
 * YAML anchor/merge key — `Variables: &DefaultVariables` / `<<: *DefaultVariables` — a hand-authored
 * convenience this form can't preserve since it re-serializes fresh on every save, per UC042's
 * documented anchor-loss tradeoff). This achieves the same practical effect without the anchor
 * syntax: every default is copied into each environment's own map, with that environment's own
 * entries (including whatever `ensureOauth2ScopeIdVariablesInEnvironments` adds afterward) taking
 * precedence over a default of the same key, mirroring how a YAML merge key's explicit keys win
 * over its merged-in ones.
 */
function mergeDefaultVariablesIntoEnvironments(
  defaults: Record<string, string>,
  environments: readonly EnvironmentEntry[]
): void {
  for (const environment of environments) {
    environment.Variables = { ...defaults, ...environment.Variables };
  }
}

/**
 * Whenever an Exposed API scope's `id` resolved to an `{{ environment.Variables.<key> }}`
 * reference (see resolveOauth2PermissionScopes/oauth2ScopeIdReference.ts), that key must actually
 * exist in *every* environment's `Variables` map for the reference to resolve to anything once
 * deploy tooling exists — so this guarantees it does, generating a fresh GUID for any environment
 * where it's still missing (a real GUID is exactly as valid a placeholder as any other, since Graph
 * only requires *a* GUID-shaped id, not a specific one) without disturbing an environment that
 * already has a value for that key, or any of its other Variables entries.
 */
function ensureOauth2ScopeIdVariablesInEnvironments(
  scopes: readonly Oauth2PermissionScopeEntry[],
  environments: readonly EnvironmentEntry[]
): void {
  const variableNames = new Set<string>();
  for (const scope of scopes) {
    const name = parseEnvironmentVariableIdName(scope.id);
    if (name) {
      variableNames.add(name);
    }
  }
  if (variableNames.size === 0) {
    return;
  }
  for (const environment of environments) {
    for (const name of variableNames) {
      if (!Object.prototype.hasOwnProperty.call(environment.Variables, name)) {
        environment.Variables[name] = crypto.randomUUID();
      }
    }
  }
}
