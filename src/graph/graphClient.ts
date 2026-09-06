import { Cloud } from '../connections/types';
import { GRAPH_HOST } from './graphHosts';

/** The subset of Graph's `application` resource this extension currently displays (UC030). */
export interface GraphApplication {
  id: string;
  appId: string;
  displayName: string;
}

interface GraphListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

/** The subset of Graph's `servicePrincipal` resource UC030's tree uses to group applications by environment. */
export interface GraphServicePrincipal {
  id: string;
  appId: string;
  displayName: string;
  tags: string[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeApplication(entry: unknown): GraphApplication {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return { id: asString(obj.id), appId: asString(obj.appId), displayName: asString(obj.displayName) };
}

function normalizeServicePrincipal(entry: unknown): GraphServicePrincipal {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return {
    id: asString(obj.id),
    appId: asString(obj.appId),
    displayName: asString(obj.displayName),
    tags: asStringArray(obj.tags),
  };
}

/**
 * UC030 — lists every application (app registration) in a tenant, following `@odata.nextLink`
 * automatically until the full set has been fetched, rather than exposing manual "Load more"
 * paging to the caller (a simplification over UC030's full alternate-flow spec, which still
 * describes incremental paging for a future, very-large-tenant scenario).
 */
export async function listApplications(accessToken: string, cloud: Cloud): Promise<GraphApplication[]> {
  const applications: GraphApplication[] = [];
  let url: string | undefined = `https://${GRAPH_HOST[cloud]}/v1.0/applications?$select=id,appId,displayName`;

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Microsoft Graph returned ${response.status} ${response.statusText} listing applications` +
          (body ? `: ${body}` : '.')
      );
    }
    const page = (await response.json()) as GraphListResponse<unknown>;
    applications.push(...page.value.map(normalizeApplication));
    url = page['@odata.nextLink'];
  }

  return applications;
}

/**
 * UC030 — lists every service principal (enterprise application) in a tenant, following
 * `@odata.nextLink` automatically the same way listApplications() does. Only
 * `id`/`appId`/`displayName`/`tags` are selected: the tree uses these solely to read each
 * application's deploy-time `Environment:<name>` tag (UC042's Generated tags convention) and
 * group the connection's applications by logical environment.
 */
export async function listServicePrincipals(accessToken: string, cloud: Cloud): Promise<GraphServicePrincipal[]> {
  const servicePrincipals: GraphServicePrincipal[] = [];
  let url: string | undefined =
    `https://${GRAPH_HOST[cloud]}/v1.0/servicePrincipals?$select=id,appId,displayName,tags`;

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Microsoft Graph returned ${response.status} ${response.statusText} listing service principals` +
          (body ? `: ${body}` : '.')
      );
    }
    const page = (await response.json()) as GraphListResponse<unknown>;
    servicePrincipals.push(...page.value.map(normalizeServicePrincipal));
    url = page['@odata.nextLink'];
  }

  return servicePrincipals;
}

/**
 * UC034 — fetches one application's full Graph representation (every field, not just the
 * id/appId/displayName subset listApplications() selects), for previewing before download.
 * `@odata.context` — Graph's own response-shape metadata, not part of the object itself — is
 * stripped, since it's noise in a preview and isn't part of what UC020 would eventually persist.
 */
export async function getApplication(accessToken: string, cloud: Cloud, id: string): Promise<Record<string, unknown>> {
  const url = `https://${GRAPH_HOST[cloud]}/v1.0/applications/${encodeURIComponent(id)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Microsoft Graph returned ${response.status} ${response.statusText} fetching application "${id}"` +
        (body ? `: ${body}` : '.')
    );
  }
  const application = (await response.json()) as Record<string, unknown>;
  delete application['@odata.context'];
  return application;
}

/**
 * UC034 — lists an application's federated identity credentials, following `@odata.nextLink` the
 * same way listApplications() does. Graph typically returns very few per application, but paging
 * is still handled for correctness rather than assuming that always holds.
 */
export async function listFederatedIdentityCredentials(
  accessToken: string,
  cloud: Cloud,
  applicationId: string
): Promise<unknown[]> {
  const entries: unknown[] = [];
  let url: string | undefined =
    `https://${GRAPH_HOST[cloud]}/v1.0/applications/${encodeURIComponent(applicationId)}/federatedIdentityCredentials`;

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Microsoft Graph returned ${response.status} ${response.statusText} listing federated identity credentials for application "${applicationId}"` +
          (body ? `: ${body}` : '.')
      );
    }
    const page = (await response.json()) as GraphListResponse<unknown>;
    entries.push(...page.value);
    url = page['@odata.nextLink'];
  }

  return entries;
}

/**
 * UC034 — looks up the Enterprise Application (Service Principal) for an App Registration's
 * appId. Returns undefined if none exists — a valid, if unusual, state: a Service Principal isn't
 * created automatically alongside every Application.
 */
export async function getServicePrincipalByAppId(
  accessToken: string,
  cloud: Cloud,
  appId: string
): Promise<Record<string, unknown> | undefined> {
  const filter = encodeURIComponent(`appId eq '${appId}'`);
  const url = `https://${GRAPH_HOST[cloud]}/v1.0/servicePrincipals?$filter=${filter}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Microsoft Graph returned ${response.status} ${response.statusText} looking up the service principal for appId "${appId}"` +
        (body ? `: ${body}` : '.')
    );
  }
  const page = (await response.json()) as GraphListResponse<Record<string, unknown>>;
  return page.value[0];
}

/** One entry in a resource application's exposed permission catalogue — see `getResourceApplicationPermissions`. */
export interface GraphResourcePermission {
  name: string;
  type: 'Role' | 'Scope';
}

/** A resource application's display name, its Service Principal's tags, plus its exposed permissions keyed by permission ID. */
export interface GraphResourceApplication {
  displayName: string;
  /** The resource Service Principal's `tags` — carries the `AppName:<Env>_<BU>_<AppName>` generated tag when the resource was deployed through UC042's tagging convention; `[]` for the static Microsoft Graph catalogue. */
  tags: string[];
  permissions: Record<string, GraphResourcePermission>;
}

/**
 * UC034 — resolves a `RequiredPermission.resourceAppId` other than Microsoft Graph's well-known ID
 * (see `graph/wellKnownPermissions.ts`, which covers Graph itself from a checked-in catalogue) by
 * looking up that resource application's own Service Principal at runtime: its `displayName`, and
 * its `appRoles` (`type: 'Role'`) / `oauth2PermissionScopes` (`type: 'Scope'`) — the same shape
 * `scripts/downloadGraphPermissions.js`'s `--from-tenant` mode parses for Microsoft Graph itself,
 * applied here to an arbitrary resource. Returns undefined if no Service Principal exists for that
 * appId in this tenant (e.g. the resource has never been consented to here).
 */
export async function getResourceApplicationPermissions(
  accessToken: string,
  cloud: Cloud,
  resourceAppId: string
): Promise<GraphResourceApplication | undefined> {
  const filter = encodeURIComponent(`appId eq '${resourceAppId}'`);
  const url = `https://${GRAPH_HOST[cloud]}/v1.0/servicePrincipals?$filter=${filter}&$select=displayName,tags,appRoles,oauth2PermissionScopes`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Microsoft Graph returned ${response.status} ${response.statusText} looking up resource application "${resourceAppId}"` +
        (body ? `: ${body}` : '.')
    );
  }
  const page = (await response.json()) as GraphListResponse<Record<string, unknown>>;
  const servicePrincipal = page.value[0];
  if (!servicePrincipal) {
    return undefined;
  }

  const permissions: Record<string, GraphResourcePermission> = {};
  const appRoles = Array.isArray(servicePrincipal.appRoles) ? servicePrincipal.appRoles : [];
  for (const role of appRoles as Array<Record<string, unknown>>) {
    permissions[asString(role.id)] = { name: asString(role.value), type: 'Role' };
  }
  const oauth2PermissionScopes = Array.isArray(servicePrincipal.oauth2PermissionScopes)
    ? servicePrincipal.oauth2PermissionScopes
    : [];
  for (const scope of oauth2PermissionScopes as Array<Record<string, unknown>>) {
    permissions[asString(scope.id)] = { name: asString(scope.value), type: 'Scope' };
  }

  return {
    displayName: asString(servicePrincipal.displayName) || resourceAppId,
    tags: asStringArray(servicePrincipal.tags),
    permissions,
  };
}
