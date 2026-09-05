/**
 * Field names here are exactly as specified for AppConfig.yaml (UC040) — including its mixed
 * casing (`application_name`, `publisherDomain`, `tenancy_type`) — deliberately not translated to
 * this codebase's usual camelCase, so the type stays visibly traceable to the on-disk format it
 * round-trips.
 */
export interface EnvironmentEntry {
  name: string;
  publisherDomain: string;
  tenancy_type: string;
  environment_code: string;
}

export interface AppConfig {
  application_name: string;
  business_unit: string;
  Variables: Record<string, string>;
  Environments: EnvironmentEntry[];
}

export type SignInAudience =
  | 'AzureADMyOrg'
  | 'AzureADMultipleOrgs'
  | 'AzureADandPersonalMicrosoftAccount'
  | 'PersonalMicrosoftAccount';

const SIGN_IN_AUDIENCES: readonly SignInAudience[] = [
  'AzureADMyOrg',
  'AzureADMultipleOrgs',
  'AzureADandPersonalMicrosoftAccount',
  'PersonalMicrosoftAccount',
];

/**
 * One row of the form's flat "Required permissions" list — deliberately denormalized from
 * Graph's actual `requiredResourceAccess: [{ resourceAppId, resourceAccess: [{ id, type }] }]`
 * shape (one entry per resource, each with a nested list of permissions) so the form needs only
 * one flat dynamic list, not a two-level nested one. Rows sharing a `resourceAppId` are grouped
 * back into that nested shape on save (see groupRequiredPermissions) and split back into rows on
 * load (see flattenRequiredResourceAccess) — the file format is unaffected by this UI choice.
 */
export interface RequiredPermission {
  resourceAppId: string;
  id: string;
  type: 'Role' | 'Scope';
}

export interface ApplicationFields {
  displayName: string;
  signInAudience: SignInAudience;
  redirectUris: string[];
  requiredPermissions: RequiredPermission[];
}

/**
 * `audiences` is a list in the Graph shape (and stays one on disk), but is edited here as a
 * single comma-separated field rather than its own nested dynamic list — the overwhelmingly
 * common case is exactly one audience, and comma-splitting still round-trips more than one
 * without needing a second level of nested UI (see ApplicationFormPanel).
 */
export interface FederatedCredentialEntry {
  name: string;
  issuer: string;
  subject: string;
  audiences: string[];
  description: string;
}

export interface ServicePrincipalFields {
  appId: string;
  appRoleAssignmentRequired: boolean;
  tags: string[];
}

/** The full set of an application's files (UC040), as loaded for/produced by the structured webview (UC042). */
export interface ApplicationFiles {
  appConfig: AppConfig;
  application: ApplicationFields;
  federatedCredentials: FederatedCredentialEntry[];
  servicePrincipal: ServicePrincipalFields;
}

export function emptyAppConfig(): AppConfig {
  return { application_name: '', business_unit: '', Variables: {}, Environments: [] };
}

export function emptyApplicationFields(): ApplicationFields {
  return { displayName: '', signInAudience: 'AzureADMyOrg', redirectUris: [], requiredPermissions: [] };
}

export function emptyServicePrincipalFields(): ServicePrincipalFields {
  return { appId: '', appRoleAssignmentRequired: false, tags: [] };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * AppConfig.yaml has no fixed schema enforced elsewhere, so a hand-edited file could be missing
 * fields, have the wrong types, or (per UC040) carry extra keys on an environment this form
 * doesn't know about. This normalizes whatever YAML.parse() produced into the shape the
 * structured form expects — silently dropping anything it doesn't recognize (see UC042's
 * documented limitation) rather than throwing on a file that predates or exceeds this schema.
 */
export function normalizeAppConfig(parsed: unknown): AppConfig {
  if (!parsed || typeof parsed !== 'object') {
    return emptyAppConfig();
  }
  const obj = parsed as Record<string, unknown>;

  const variables: Record<string, string> = {};
  if (obj.Variables && typeof obj.Variables === 'object') {
    for (const [key, value] of Object.entries(obj.Variables as Record<string, unknown>)) {
      variables[key] = typeof value === 'string' ? value : String(value);
    }
  }

  const environments: EnvironmentEntry[] = Array.isArray(obj.Environments)
    ? obj.Environments.map((entry) => normalizeEnvironmentEntry(entry))
    : [];

  return {
    application_name: asString(obj.application_name),
    business_unit: asString(obj.business_unit),
    Variables: variables,
    Environments: environments,
  };
}

function normalizeEnvironmentEntry(entry: unknown): EnvironmentEntry {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return {
    name: asString(obj.name),
    publisherDomain: asString(obj.publisherDomain),
    tenancy_type: asString(obj.tenancy_type),
    environment_code: asString(obj.environment_code),
  };
}

/**
 * Same "tolerate anything, drop what's unrecognized" normalization as normalizeAppConfig, applied
 * to Application.yaml.j2's Graph-shaped content. `requiredResourceAccess`'s nested shape is
 * flattened to the form's flat row list here (see RequiredPermission's doc comment).
 */
export function normalizeApplicationFields(parsed: unknown): ApplicationFields {
  if (!parsed || typeof parsed !== 'object') {
    return emptyApplicationFields();
  }
  const obj = parsed as Record<string, unknown>;
  const web = obj.web && typeof obj.web === 'object' ? (obj.web as Record<string, unknown>) : {};
  const signInAudience = SIGN_IN_AUDIENCES.includes(obj.signInAudience as SignInAudience)
    ? (obj.signInAudience as SignInAudience)
    : 'AzureADMyOrg';

  return {
    displayName: asString(obj.displayName),
    signInAudience,
    redirectUris: asStringArray(web.redirectUris),
    requiredPermissions: flattenRequiredResourceAccess(obj.requiredResourceAccess),
  };
}

function flattenRequiredResourceAccess(parsed: unknown): RequiredPermission[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rows: RequiredPermission[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const resourceAppId = asString(obj.resourceAppId);
    const access = Array.isArray(obj.resourceAccess) ? obj.resourceAccess : [];
    for (const item of access) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const itemObj = item as Record<string, unknown>;
      rows.push({ resourceAppId, id: asString(itemObj.id), type: itemObj.type === 'Role' ? 'Role' : 'Scope' });
    }
  }
  return rows;
}

/** The inverse of flattenRequiredResourceAccess — groups flat rows back into Graph's nested shape, preserving first-seen order. */
export function groupRequiredPermissions(rows: readonly RequiredPermission[]): Array<{
  resourceAppId: string;
  resourceAccess: Array<{ id: string; type: 'Role' | 'Scope' }>;
}> {
  const order: string[] = [];
  const byResource = new Map<string, Array<{ id: string; type: 'Role' | 'Scope' }>>();
  for (const row of rows) {
    if (!byResource.has(row.resourceAppId)) {
      byResource.set(row.resourceAppId, []);
      order.push(row.resourceAppId);
    }
    byResource.get(row.resourceAppId)!.push({ id: row.id, type: row.type });
  }
  return order.map((resourceAppId) => ({ resourceAppId, resourceAccess: byResource.get(resourceAppId)! }));
}

export function normalizeFederatedCredentials(parsed: unknown): FederatedCredentialEntry[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((entry) => {
    const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      name: asString(obj.name),
      issuer: asString(obj.issuer),
      subject: asString(obj.subject),
      audiences: asStringArray(obj.audiences),
      description: asString(obj.description),
    };
  });
}

export function normalizeServicePrincipalFields(parsed: unknown): ServicePrincipalFields {
  if (!parsed || typeof parsed !== 'object') {
    return emptyServicePrincipalFields();
  }
  const obj = parsed as Record<string, unknown>;
  return {
    appId: asString(obj.appId),
    appRoleAssignmentRequired: obj.appRoleAssignmentRequired === true,
    tags: asStringArray(obj.tags),
  };
}
