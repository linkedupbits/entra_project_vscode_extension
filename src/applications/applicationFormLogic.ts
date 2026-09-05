import {
  AppConfig,
  ApplicationFields,
  ApplicationFiles,
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
  | { kind: 'ok'; files: ApplicationFiles };

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
 * dropped, not an error); Environment names must be present and unique. Everything else
 * (the Application/FederatedCredentials/ServicePrincipal sections) is structural cleanup — trim,
 * drop blank rows, coerce enum-like fields to a valid value — not hard validation, since UC040
 * never specified stricter rules than "mirror the Graph JSON shape", and inventing them here would
 * be asserting requirements nobody asked for.
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

  const appConfig: AppConfig = {
    application_name: applicationName,
    business_unit: input.business_unit.trim(),
    Variables: variables,
    Environments: environments,
  };

  return {
    kind: 'ok',
    files: {
      appConfig,
      application: resolveApplication(input.application),
      federatedCredentials: resolveFederatedCredentials(input.federatedCredentials),
      servicePrincipal: resolveServicePrincipal(input.servicePrincipal),
    },
  };
}
