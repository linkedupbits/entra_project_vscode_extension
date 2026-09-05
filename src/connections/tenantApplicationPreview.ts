import { Connection } from './types';
import { AuthService } from '../auth/authService';
import {
  GraphApplication,
  GraphResourceApplication,
  getApplication,
  listFederatedIdentityCredentials,
  getServicePrincipalByAppId,
  getResourceApplicationPermissions,
} from '../graph/graphClient';
import { getWellKnownResourceApplication } from '../graph/wellKnownPermissions';
import {
  ApplicationFields,
  FederatedCredentialEntry,
  RequiredPermission,
  ServicePrincipalFields,
  normalizeApplicationFields,
  normalizeFederatedCredentials,
  normalizeServicePrincipalFields,
} from '../applications/types';

export type SectionResult<T> = { kind: 'ok'; value: T } | { kind: 'error'; message: string };

export interface ApplicationPreviewData {
  application: SectionResult<ApplicationFields>;
  /**
   * Graph's `application.publisherDomain` field, read directly off the raw fetch result — not
   * modelled by `ApplicationFields`/UC042 (a local application definition has no such concept),
   * kept only for `downloadApplicationToProject()` to seed a new Environment entry's
   * `publisherDomain` from (see UC035 A5). Blank if the application section itself failed to load
   * or the field was absent.
   */
  applicationPublisherDomain: string;
  /**
   * Every distinct `resourceAppId` referenced by `application.value.requiredPermissions`,
   * resolved to that resource's display name and permission catalogue — Microsoft Graph from the
   * checked-in `wellKnownPermissions.ts` data, any other resource via a live Graph lookup (see
   * `getResourceApplicationPermissions()`). A resourceAppId absent from this map means it
   * couldn't be resolved (lookup failed, or no Service Principal exists for it in this tenant);
   * `applicationPreviewHtml.ts` falls back to showing raw IDs for that resource's rows.
   */
  resourceApplications: Record<string, GraphResourceApplication>;
  federatedCredentials: SectionResult<FederatedCredentialEntry[]>;
  servicePrincipal: SectionResult<ServicePrincipalFields>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolves every distinct resourceAppId in `requiredPermissions` to its display name + permission
 * catalogue — Microsoft Graph from the static, checked-in data (no network call), everything else
 * via one live Graph lookup per distinct resource (not per permission row, and not per duplicate
 * reference across rows). A resource that fails to resolve (lookup error, or no Service Principal
 * for it in this tenant) is simply absent from the result — not a whole-preview failure, matching
 * the per-section failure isolation `loadApplicationPreview()` already uses elsewhere.
 */
async function resolveResourceApplications(
  accessToken: string,
  cloud: Connection['cloud'],
  requiredPermissions: readonly RequiredPermission[]
): Promise<Record<string, GraphResourceApplication>> {
  const resourceAppIds = [...new Set(requiredPermissions.map((p) => p.resourceAppId).filter((id) => id.length > 0))];

  const resolved: Record<string, GraphResourceApplication> = {};
  const toFetch: string[] = [];
  for (const resourceAppId of resourceAppIds) {
    const wellKnown = getWellKnownResourceApplication(resourceAppId);
    if (wellKnown) {
      resolved[resourceAppId] = wellKnown;
    } else {
      toFetch.push(resourceAppId);
    }
  }

  const fetched = await Promise.allSettled(
    toFetch.map((resourceAppId) => getResourceApplicationPermissions(accessToken, cloud, resourceAppId))
  );
  fetched.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      resolved[toFetch[index]] = result.value;
    }
  });

  return resolved;
}

/**
 * UC034 — fetches an application's full Graph representation plus its related Federated Identity
 * Credentials and Service Principal (the same three files UC042's structured editor shows for a
 * local application definition), normalizing each through `applications/types.ts`'s existing
 * normalize functions — so a tenant application previews with the same field mapping (and the
 * same modeling limitations) as a local one, rather than a second, drifting implementation of it.
 *
 * The three Graph calls run independently via `Promise.allSettled`, so a failure in one (e.g. a
 * missing permission for service principals) doesn't blank out the other two — that section's
 * result carries its own error instead, for `buildApplicationPreviewHtml` to render in place.
 * Acquiring the access token itself is not part of that settlement: if the caller isn't connected
 * at all, this function rejects outright, since there is nothing to show for any section.
 */
export async function loadApplicationPreview(
  authService: AuthService,
  connection: Connection,
  application: GraphApplication
): Promise<ApplicationPreviewData> {
  const accessToken = await authService.getGraphAccessToken(connection);

  const [applicationResult, federatedCredentialsResult, servicePrincipalResult] = await Promise.allSettled([
    getApplication(accessToken, connection.cloud, application.id),
    listFederatedIdentityCredentials(accessToken, connection.cloud, application.id),
    getServicePrincipalByAppId(accessToken, connection.cloud, application.appId),
  ]);

  const applicationSection: SectionResult<ApplicationFields> =
    applicationResult.status === 'fulfilled'
      ? { kind: 'ok', value: normalizeApplicationFields(applicationResult.value) }
      : { kind: 'error', message: errorMessage(applicationResult.reason) };
  const resourceApplications =
    applicationSection.kind === 'ok'
      ? await resolveResourceApplications(accessToken, connection.cloud, applicationSection.value.requiredPermissions)
      : {};

  return {
    application: applicationSection,
    applicationPublisherDomain:
      applicationResult.status === 'fulfilled' ? asString(applicationResult.value.publisherDomain) : '',
    resourceApplications,
    federatedCredentials:
      federatedCredentialsResult.status === 'fulfilled'
        ? { kind: 'ok', value: normalizeFederatedCredentials(federatedCredentialsResult.value) }
        : { kind: 'error', message: errorMessage(federatedCredentialsResult.reason) },
    servicePrincipal:
      servicePrincipalResult.status === 'fulfilled'
        ? { kind: 'ok', value: normalizeServicePrincipalFields(servicePrincipalResult.value) }
        : { kind: 'error', message: errorMessage(servicePrincipalResult.reason) },
  };
}
