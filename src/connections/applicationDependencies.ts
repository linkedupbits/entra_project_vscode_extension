import { DependencyEntry, RequiredPermission } from '../applications/types';
import { GraphResourceApplication } from '../graph/graphClient';
import { MICROSOFT_GRAPH_APP_ID, buildDependencyReference } from '../applications/resourceAppIdReference';
import { parseTenantApplicationIdentity, parseUniqueName } from './tenantApplicationIdentity';

/** One dependency worked out from a non-Graph `resourceAppId` in an application's required permissions. */
export interface DerivedDependency {
  /** The `AppConfig.yaml` `Dependencies` map key — the name templates reference it by (`{{ dependency_refs.<key>.applicationId }}`). */
  key: string;
  /**
   * The referenced application definition's folder name — its own `AppName:` tag's `<AppName>` part
   * (or a 3-part display name) when the resource follows UC042's convention, else the resource's
   * plain display name, else its `appId` when the resource couldn't be resolved at all.
   */
  appName: string;
  /** The tenant `resourceAppId` this was derived from. */
  resourceAppId: string;
  /** Whether the resource resolved to a Service Principal (`false` = keyed by `appId` as a fallback). */
  resolved: boolean;
}

export interface ApplicationDependencyDerivation {
  /** `existingDependencies` merged with any newly derived entries — an existing entry is never overwritten. */
  dependencies: Record<string, DependencyEntry>;
  /** Just the dependencies newly derived on this pass (an entry already present under a matching key is not repeated), in first-seen order. */
  derived: DerivedDependency[];
  /**
   * The input `requiredPermissions` with every non-Graph row rewritten for a local application
   * definition: its `resourceAppId` becomes `{{ dependency_refs.<key>.applicationId }}`, and its
   * `id` becomes the resolved permission's **value** (its name, e.g. `access_as_user`) instead of
   * the tenant GUID — a dependency's scope GUID isn't fixed at authoring time, so UC042's
   * Permission Editor keys a dependency scope by its `value`, not its id (see `permissionIdOptions.ts`).
   * Rows whose `id` couldn't be resolved keep their original value; Microsoft Graph rows are
   * returned unchanged.
   */
  requiredPermissions: RequiredPermission[];
}

/** "Sample API App" → "SampleAPIApp" — a safe `Dependencies` map key / folder-name guess (see UC040's own example). */
function referenceKeyFromName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '');
}

/**
 * The application-definition folder name to record for a resolved resource: its own
 * `AppName:<Env>_<BU>_<AppName>` generated tag's `<AppName>` part if it carries one (the same value
 * a direct download of that resource — UC035 — would name its folder, so a dependency and a direct
 * download land in the *same* folder), else its display name parsed as that 3-part form if it
 * happens to follow the convention, else the raw display name.
 */
function dependencyFolderName(resource: GraphResourceApplication): string {
  const displayName = resource.displayName.trim();
  const identity = parseTenantApplicationIdentity(resource.tags) ?? parseUniqueName(displayName);
  return identity ? identity.appName : displayName;
}

/**
 * UC034/UC035 — reads an application's Required Permissions and, for every distinct `resourceAppId`
 * that isn't Microsoft Graph's well-known ID, works out a dependency on another application: its
 * `AppConfig.yaml` `Dependencies` entry (`AppName` = that resource's application-definition folder
 * name per `dependencyFolderName()` — its `AppName:` tag's `<AppName>` part where it has one, so a
 * dependency and a direct download of the same resource share a folder; keyed by that name squashed
 * to alphanumerics, or by the `appId` when the resource has no Service Principal in the tenant and
 * so couldn't be resolved), plus the `{{ dependency_refs.<key>.applicationId }}` reference the
 * matching permission rows' `resourceAppId` should be rewritten to so UC042's editor recognises
 * them.
 *
 * Microsoft Graph permissions are deliberately excluded — Graph isn't "another application" in the
 * project, and UC042 already models it as a first-class `resourceAppId` dropdown choice.
 *
 * `existingDependencies` is merged, never overwritten: if one already points at the same
 * application (by `AppName`), its key is reused for the rewrite rather than a second entry being
 * added.
 */
export function deriveApplicationDependencies(
  requiredPermissions: readonly RequiredPermission[],
  resourceApplications: Record<string, GraphResourceApplication>,
  existingDependencies: Record<string, DependencyEntry>
): ApplicationDependencyDerivation {
  const dependencies: Record<string, DependencyEntry> = { ...existingDependencies };
  const derived: DerivedDependency[] = [];
  const resourceAppIdRewrites = new Map<string, string>();

  const distinctResourceAppIds = [
    ...new Set(
      requiredPermissions.map((p) => p.resourceAppId).filter((id) => id.length > 0 && id !== MICROSOFT_GRAPH_APP_ID)
    ),
  ];

  for (const resourceAppId of distinctResourceAppIds) {
    const resource = resourceApplications[resourceAppId];
    const folderName = resource ? dependencyFolderName(resource) : '';
    const resolved = folderName.length > 0;
    const appName = resolved ? folderName : resourceAppId;

    const existingKey = Object.keys(dependencies).find((k) => dependencies[k].AppName === appName);
    if (existingKey) {
      resourceAppIdRewrites.set(resourceAppId, buildDependencyReference(existingKey));
      continue;
    }

    const preferred = (resolved && referenceKeyFromName(appName)) || resourceAppId;
    const key = preferred in dependencies ? resourceAppId : preferred;
    dependencies[key] = { AppName: appName };
    derived.push({ key, appName, resourceAppId, resolved });
    resourceAppIdRewrites.set(resourceAppId, buildDependencyReference(key));
  }

  const rewrittenPermissions = requiredPermissions.map((permission) => {
    const reference = resourceAppIdRewrites.get(permission.resourceAppId);
    if (!reference) {
      return { ...permission };
    }
    const scopeValue = resourceApplications[permission.resourceAppId]?.permissions[permission.id]?.name ?? '';
    return {
      ...permission,
      resourceAppId: reference,
      id: scopeValue.length > 0 ? scopeValue : permission.id,
    };
  });

  return { dependencies, derived, requiredPermissions: rewrittenPermissions };
}
