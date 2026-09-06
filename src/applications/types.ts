import * as YAML from 'yaml';

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
  /**
   * Per-environment values, distinct from AppConfig.yaml's shared top-level `Variables` — this is
   * where UC042's editor parks an `Exposed API scopes` row's generated `id`, referenced from
   * `Application.yaml.j2` as `{{ environment.Variables.<key> }}` (see `oauth2ScopeIdReference.ts`),
   * so the same logical scope's id can be a fixed real GUID per deployment target without hardcoding
   * one directly into the template. It also holds this environment's redirect URIs — three string
   * *array* values under the keys in `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS` (`web_redirectUris` /
   * `publicClient_redirectURIs` / `spa_redirectURIs`), since redirect URIs are defined per
   * deployment target, not once on the App Registration (UC042). Hence the value type is
   * `string | string[]`, not just `string`.
   *
   * In memory this always holds the environment's *full effective* set (shared defaults already
   * merged in — see `resolveApplicationSubmit`'s `mergeDefaultVariablesIntoEnvironments`); on disk
   * only its `overridesOnly()` subset is written, alongside a `<<: *DefaultVariables` alias (see
   * `buildAppConfigNode`). UC042's editor exposes that overrides-only subset as an editable
   * per-environment Variables list (redirect URIs get their own three lists in the same card);
   * `ensureOauth2ScopeIdVariablesInEnvironments` guarantees a referenced key exists here, generating
   * a GUID for it if missing, on every save.
   */
  Variables: Record<string, string | string[]>;
}

/**
 * The three `EnvironmentEntry.Variables` keys that hold an environment's redirect URIs as string
 * arrays — one per Entra redirect-URI category. The casing is deliberately inconsistent
 * (`Uris` vs `URIs`) to match exactly what was specified for the on-disk format (UC042/UC040).
 */
export const ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS = {
  web: 'web_redirectUris',
  publicClient: 'publicClient_redirectURIs',
  spa: 'spa_redirectURIs',
} as const;

/**
 * The templating expression written as `ServicePrincipal.yaml.j2`'s `replyUrls` value on every
 * save (see `serializeServicePrincipal`). A `{% for %}` loop that emits literal YAML array syntax
 * — so the *rendered* file contains a genuine array — over the current environment's three
 * redirect-URI variable lists concatenated with `+`, each `| default([])` so a category the
 * environment doesn't define contributes nothing. Deliberately a loop rather than a bare `{{ list }}`
 * interpolation: `{{ list }}` stringifies engine-specifically (`a,b` in Nunjucks, `['a', 'b']` in
 * Jinja2) and never yields a real YAML array, whereas `for` / `loop.last` / `if` / `+` / `default`
 * are all common to Jinja2 and Nunjucks, so this renders identically under both.
 *
 * It is **not valid YAML on its own** (a bare `{%` can't start a YAML value), so it can't pass
 * through `YAML.stringify` as a value: `serializeServicePrincipal` emits
 * `SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER` instead, and `applyServicePrincipalReplyUrls()` swaps
 * in this text afterwards; `stripServicePrincipalReplyUrls()` removes the line again before any
 * `YAML.parse`, since the value is generated and never read back — the same "generated, not
 * round-tripped" treatment as UC042's Generated tags preview.
 */
export const SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE = `[{% for item in ${Object.values(
  ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS
)
  .map((key) => `(environment.Variables.${key} | default([]))`)
  .join(' + ')} %}"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]`;

/** Stand-in for `replyUrls`'s value while it passes through `YAML.stringify` — see `SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE`. */
export const SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER = '__ENTRA_REPLY_URLS__';

const REPLY_URLS_PLACEHOLDER_LINE = new RegExp(
  `^([ \\t]*replyUrls:) ["']?${SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER}["']?$`,
  'm'
);
const REPLY_URLS_LINE = /^[ \t]*replyUrls:.*(\r?\n|$)/m;

/**
 * Post-processes `YAML.stringify` / `Document.toString` output for a ServicePrincipal, replacing
 * the placeholder `serializeServicePrincipal` wrote with the real (non-YAML) `replyUrls` loop
 * template. Preserves the line's indentation, so it works both for the standalone
 * `ServicePrincipal.yaml.j2` and for the nested `ServicePrincipal:` key in the combined document.
 */
export function applyServicePrincipalReplyUrls(yamlText: string): string {
  return yamlText.replace(REPLY_URLS_PLACEHOLDER_LINE, (_match, prefix: string) => `${prefix} ${SERVICE_PRINCIPAL_REPLY_URLS_TEMPLATE}`);
}

/**
 * Removes the generated `replyUrls:` line before `YAML.parse` — once `applyServicePrincipalReplyUrls`
 * has run, that line holds a `{% for %}` loop that isn't valid YAML. Safe because the value is
 * regenerated on every save and never read back (`normalizeServicePrincipalFields` doesn't model it).
 */
export function stripServicePrincipalReplyUrls(yamlText: string): string {
  return yamlText.replace(REPLY_URLS_LINE, '');
}

/**
 * One entry in `AppConfig.yaml`'s `Dependencies` map — a reference to another application
 * definition's folder (`AppName`, matching that application's folder name under
 * `<root>/Applications/`, not a Graph ID) that this one depends on for deploy-time sequencing.
 * The map's own key (not stored on the entry itself) is the name a template refers to it by, e.g.
 * `{{ dependency_refs.SampleAPIApp.applicationId }}` in `Application.yaml.j2` — resolved once
 * deploy tooling exists, from that referenced application's own prior deploy result, the same way
 * `ServicePrincipal.yaml.j2`'s `{{ application.appId }}` resolves from this application's own.
 */
export interface DependencyEntry {
  AppName: string;
}

export interface AppConfig {
  application_name: string;
  business_unit: string;
  Variables: Record<string, string>;
  Environments: EnvironmentEntry[];
  Dependencies: Record<string, DependencyEntry>;
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

/**
 * One entry in `Application.yaml.j2`'s `api.oauth2PermissionScopes` — a delegated permission scope
 * this application *exposes* for other applications to request, the mirror image of
 * `RequiredPermission` above (which is what this application requests *from* other resources).
 * Field names and shapes match Graph's `permissionScope` type exactly, one row per scope with no
 * flattening/grouping needed (unlike `RequiredPermission`, there's no nested list-of-lists here).
 * `id` is a GUID Graph uses to match this scope across updates — once a scope has been deployed,
 * changing its `id` would cause a redeploy to create a new scope rather than update the existing
 * one, so UC042's editor generates one automatically for a new row and otherwise leaves it alone
 * (see `applicationEditorHtml.ts`), never exposing it as something a user hand-edits.
 */
export interface Oauth2PermissionScopeEntry {
  id: string;
  value: string;
  type: 'User' | 'Admin';
  adminConsentDisplayName: string;
  adminConsentDescription: string;
  userConsentDisplayName: string;
  userConsentDescription: string;
  isEnabled: boolean;
}

export interface ApplicationFields {
  displayName: string;
  signInAudience: SignInAudience;
  requiredPermissions: RequiredPermission[];
  oauth2PermissionScopes: Oauth2PermissionScopeEntry[];
}

/**
 * `audiences` is a list in the Graph shape (and stays one on disk), but is edited here as a
 * single comma-separated field rather than its own nested dynamic list — the overwhelmingly
 * common case is exactly one audience, and comma-splitting still round-trips more than one
 * without needing a second level of nested UI (see UC042's editor, `applicationEditorHtml.ts`).
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
  return { application_name: '', business_unit: '', Variables: {}, Environments: [], Dependencies: {} };
}

export function emptyApplicationFields(): ApplicationFields {
  return { displayName: '', signInAudience: 'AzureADMyOrg', requiredPermissions: [], oauth2PermissionScopes: [] };
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
 * A "Variables" map's values are meant to be plain scalars — a number/boolean is coerced to its
 * string form (e.g. `retries: 3` becomes `'3'`), same as everywhere else in this schema that
 * tolerates a slightly-off type rather than dropping the value. An object/array value is skipped
 * instead of coerced: `String()`-ing one produces useless text like `"[object Object]"`, which
 * would silently corrupt the map rather than describe it — most likely from a YAML merge key
 * (`<<: *Anchor`) the `yaml` package left unresolved as a literal `"<<"` entry rather than
 * splicing in the anchor's own keys, since this codebase doesn't enable YAML 1.1 merge-key support.
 */
function asVariablesRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') {
        result[key] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        result[key] = String(v);
      }
    }
  }
  return result;
}

/**
 * Like `asVariablesRecord`, but for an environment's own `Variables` map (`EnvironmentEntry`),
 * which additionally holds redirect-URI *arrays* (see `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS`).
 * A string-array value is kept (its non-string entries dropped); every other array/object value is
 * still skipped for the same reason `asVariablesRecord` skips them (an unresolved YAML merge key,
 * or a value this schema doesn't model).
 */
function asEnvironmentVariablesRecord(value: unknown): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') {
        result[key] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        result[key] = String(v);
      } else if (Array.isArray(v)) {
        result[key] = v.filter((item): item is string => typeof item === 'string');
      }
    }
  }
  return result;
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

  const variables = asVariablesRecord(obj.Variables);

  const environments: EnvironmentEntry[] = Array.isArray(obj.Environments)
    ? obj.Environments.map((entry) => normalizeEnvironmentEntry(entry))
    : [];

  const dependencies: Record<string, DependencyEntry> = {};
  if (obj.Dependencies && typeof obj.Dependencies === 'object') {
    for (const [key, value] of Object.entries(obj.Dependencies as Record<string, unknown>)) {
      dependencies[key] = normalizeDependencyEntry(value);
    }
  }

  return {
    application_name: asString(obj.application_name),
    business_unit: asString(obj.business_unit),
    Variables: variables,
    Environments: environments,
    Dependencies: dependencies,
  };
}

function normalizeEnvironmentEntry(entry: unknown): EnvironmentEntry {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return {
    name: asString(obj.name),
    publisherDomain: asString(obj.publisherDomain),
    tenancy_type: asString(obj.tenancy_type),
    environment_code: asString(obj.environment_code),
    Variables: asEnvironmentVariablesRecord(obj.Variables),
  };
}

function normalizeDependencyEntry(entry: unknown): DependencyEntry {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return { AppName: asString(obj.AppName) };
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
  const api = obj.api && typeof obj.api === 'object' ? (obj.api as Record<string, unknown>) : {};
  const signInAudience = SIGN_IN_AUDIENCES.includes(obj.signInAudience as SignInAudience)
    ? (obj.signInAudience as SignInAudience)
    : 'AzureADMyOrg';

  return {
    displayName: asString(obj.displayName),
    signInAudience,
    requiredPermissions: flattenRequiredResourceAccess(obj.requiredResourceAccess),
    oauth2PermissionScopes: normalizeOauth2PermissionScopes(api.oauth2PermissionScopes),
  };
}

function normalizeOauth2PermissionScopes(parsed: unknown): Oauth2PermissionScopeEntry[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((entry) => {
    const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      id: asString(obj.id),
      value: asString(obj.value),
      type: obj.type === 'Admin' ? 'Admin' : 'User',
      adminConsentDisplayName: asString(obj.adminConsentDisplayName),
      adminConsentDescription: asString(obj.adminConsentDescription),
      userConsentDisplayName: asString(obj.userConsentDisplayName),
      userConsentDescription: asString(obj.userConsentDescription),
      // Graph itself defaults a scope to enabled when the field is omitted at creation, so an
      // absent/non-boolean value here is treated as enabled too — unlike appRoleAssignmentRequired
      // below, whose Graph default is false.
      isEnabled: obj.isEnabled !== false,
    };
  });
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

/**
 * Builds the exact Graph JSON shape for Application.yaml.j2 from the form's flat
 * `requiredPermissions` rows — see RequiredPermission's doc comment above. Empty optional sections
 * (`requiredResourceAccess`, `api`) are omitted entirely rather than written as `{}`/`[]`. Shared
 * by `ApplicationStore.save()` and `applicationDocumentContent.ts`'s combined virtual document, so
 * both editing surfaces write the identical on-disk shape.
 *
 * Redirect URIs are deliberately *not* written here: they're defined per deployment target and
 * live in each `EnvironmentEntry.Variables` map (see `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS`), for
 * `Application.yaml.j2` to reference as `{{ environment.Variables.web_redirectUris }}` etc. at
 * deploy time — never as a literal `web`/`spa`/`publicClient` block on the App Registration.
 */
export function serializeApplication(fields: ApplicationFields): Record<string, unknown> {
  const result: Record<string, unknown> = {
    displayName: fields.displayName,
    signInAudience: fields.signInAudience,
  };
  const grouped = groupRequiredPermissions(fields.requiredPermissions);
  if (grouped.length > 0) {
    result.requiredResourceAccess = grouped;
  }
  if (fields.oauth2PermissionScopes.length > 0) {
    result.api = { oauth2PermissionScopes: fields.oauth2PermissionScopes.map(serializeOauth2PermissionScopeEntry) };
  }
  return result;
}

function serializeOauth2PermissionScopeEntry(entry: Oauth2PermissionScopeEntry): Record<string, unknown> {
  return {
    id: entry.id,
    adminConsentDescription: entry.adminConsentDescription,
    adminConsentDisplayName: entry.adminConsentDisplayName,
    isEnabled: entry.isEnabled,
    type: entry.type,
    userConsentDescription: entry.userConsentDescription,
    userConsentDisplayName: entry.userConsentDisplayName,
    value: entry.value,
  };
}

/**
 * `AppConfig.appConfig.Environments[].Variables` always holds each environment's full *effective*
 * set (shared defaults already merged in — see `applicationFormLogic.ts`'s
 * `mergeDefaultVariablesIntoEnvironments`), which is the simplest in-memory shape to work with. On
 * disk, though, UC040 wants the shared values expressed once via a YAML anchor/merge key
 * (`Variables: &DefaultVariables` / `<<: *DefaultVariables`) rather than duplicated into every
 * environment as literal text — both for a human reading the file, and so hand-editing a default
 * actually changes it everywhere at once, same as before this form existed. This builds that node
 * directly (via the `yaml` package's `Document`/`Node` API, not a plain-object `YAML.stringify()`,
 * which has no way to express an alias) by writing back only each environment's *overrides* — a key
 * that's either new or has a different value than the shared default — alongside a `<<` alias
 * pointing at one shared, anchored `Variables` node. Reading such a file back still yields the full
 * effective set per environment, since merge-key resolution is enabled wherever this schema is
 * parsed (`{ merge: true }`) — see `ApplicationStore`/`applicationDocumentContent.ts`.
 */
export function buildAppConfigNode(doc: YAML.Document, appConfig: AppConfig): YAML.YAMLMap {
  const hasDefaults = Object.keys(appConfig.Variables).length > 0 && appConfig.Environments.length > 0;

  const node = doc.createNode({
    application_name: appConfig.application_name,
    business_unit: appConfig.business_unit,
    Variables: appConfig.Variables,
    Environments: appConfig.Environments.map((environment) => ({
      name: environment.name,
      publisherDomain: environment.publisherDomain,
      tenancy_type: environment.tenancy_type,
      environment_code: environment.environment_code,
      Variables: hasDefaults ? overridesOnly(environment.Variables, appConfig.Variables) : environment.Variables,
    })),
    Dependencies: appConfig.Dependencies,
  }) as YAML.YAMLMap;

  if (hasDefaults) {
    const variablesNode = node.get('Variables', true) as unknown as YAML.YAMLMap;
    const environmentsNode = node.get('Environments', true) as unknown as YAML.YAMLSeq;
    for (const environmentNode of environmentsNode.items as YAML.YAMLMap[]) {
      const environmentVariablesNode = environmentNode.get('Variables', true) as unknown as YAML.YAMLMap;
      environmentVariablesNode.items.unshift(doc.createPair('<<', doc.createAlias(variablesNode, 'DefaultVariables')));
    }
  }

  return node;
}

/**
 * An environment's *own* `Variables` — the subset of its full effective set (see
 * `buildAppConfigNode`) that isn't just an inherited shared default: a key that's new, or present
 * in the defaults but with a different value. This is what `buildAppConfigNode` writes to disk
 * alongside the `<<` alias, and what UC042's editor shows as that environment's editable Variables
 * list (the shared defaults are edited once, in the top-level Variables section).
 *
 * The shared top-level `Variables` are always plain strings, so an array-valued key (a redirect-URI
 * list — see `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS`) can never equal a default and is always kept
 * as an override, which is exactly right — redirect URIs are per-environment by definition.
 */
export function overridesOnly(
  variables: Record<string, string | string[]>,
  defaults: Record<string, string>
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (defaults[key] !== value) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * ServicePrincipal.yaml.j2's Graph JSON shape — see serializeApplication's doc comment for why this
 * is shared/exported. `replyUrls` is emitted as `SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER` here;
 * the caller must run the stringified output through `applyServicePrincipalReplyUrls()` to swap in
 * the real `replyUrls` loop template (which isn't valid YAML, so can't be a value here). It's a
 * generated value — any `replyUrls` already in the file is replaced on every save.
 */
export function serializeServicePrincipal(fields: ServicePrincipalFields): Record<string, unknown> {
  const result: Record<string, unknown> = {
    appId: fields.appId,
    appRoleAssignmentRequired: fields.appRoleAssignmentRequired,
    replyUrls: SERVICE_PRINCIPAL_REPLY_URLS_PLACEHOLDER,
  };
  if (fields.tags.length > 0) {
    result.tags = fields.tags;
  }
  return result;
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
