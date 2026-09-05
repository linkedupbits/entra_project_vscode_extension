import {
  AppConfig,
  ApplicationFields,
  ApplicationFiles,
  DependencyEntry,
  EnvironmentEntry,
  FederatedCredentialEntry,
  RequiredPermission,
  ServicePrincipalFields,
  SignInAudience,
} from './types';

export interface VariableRowInput {
  key: string;
  value: string;
}

export interface EnvironmentRowInput {
  name: string;
  publisherDomain: string;
  tenancy_type: string;
  environment_code: string;
}

/** `appName` is picked from the project's existing application folders, not free text — see ApplicationFormPanel. */
export interface DependencyRowInput {
  key: string;
  appName: string;
}

export interface RequiredPermissionRowInput {
  resourceAppId: string;
  id: string;
  type: string;
}

export interface ApplicationFieldsInput {
  displayName: string;
  signInAudience: string;
  redirectUris: string[];
  requiredPermissions: RequiredPermissionRowInput[];
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
 * These are the prefixes UC042's Generated tags preview uses (see ApplicationFormPanel's
 * `updateGeneratedTags()`) — reserved so a custom tag can never collide with, or be mistaken for,
 * one of those deploy-time-applied tags. Case-sensitive, matching the preview's own casing exactly.
 */
const RESERVED_TAG_PREFIXES: readonly string[] = ['AppName:', 'Environment:', 'BusinessUnit:'];

function reservedTagPrefixFor(tag: string): string | undefined {
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
  };
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
    });
  }

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

  return {
    kind: 'ok',
    files: {
      appConfig,
      application: resolveApplication(input.application),
      federatedCredentials: resolveFederatedCredentials(input.federatedCredentials),
      servicePrincipal,
    },
  };
}
