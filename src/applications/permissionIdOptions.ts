import * as vscode from 'vscode';
import { getApplicationsRootUri } from '../workspacePaths';
import { getWellKnownResourceApplication } from '../graph/wellKnownPermissions';
import { ApplicationStore } from './applicationStore';
import { DependencyEntry } from './types';
import { MICROSOFT_GRAPH_APP_ID, buildDependencyReference } from './resourceAppIdReference';

export interface PermissionOption {
  id: string;
  label: string;
  type: 'Scope' | 'Role';
}

/**
 * UC042's Required Permissions rows let a Permission ID be picked from a dropdown instead of typed
 * freehand — the available options depend on which `resourceAppId` is selected for that row (see
 * `resourceAppIdReference.ts`): Microsoft Graph's options come from the same checked-in catalogue
 * UC034's preview already resolves names from (`graph/wellKnownPermissions.ts`); a Dependency's
 * options come from that dependency's own `Application.yaml.j2` — specifically the delegated scopes
 * it exposes via `api.oauth2PermissionScopes` (UC042's own Exposed API scopes list on that other
 * application) — there is no local equivalent of an application-permission Role to offer for a
 * dependency, since this schema doesn't model `appRoles` for a locally-defined application. Neither
 * case needs a live Graph call — this stays entirely local/offline, consistent with the rest of
 * UC042 — so a third-party `resourceAppId` this dropdown doesn't otherwise recognise simply has no
 * options here either, falling back to free text the same way an unrecognised `resourceAppId` does.
 *
 * A Dependency option's `id` is deliberately the scope's own `value` (its name, e.g.
 * "access_as_user"), not its GUID — unlike Microsoft Graph's permission IDs, which are fixed and
 * well-known, a dependency's scope GUID isn't necessarily fixed at authoring time (it can itself be
 * an `{{ environment.Variables.<key> }}` reference — see `oauth2ScopeIdReference.ts`), so this
 * schema can't hardcode it into `resourceAccess[].id` the way it can for Graph. Storing the scope's
 * `value` instead defers the actual GUID lookup to deploy time, the same way `dependency_refs`
 * already defers resolving the dependency's own `applicationId` — deploy tooling looks up the
 * dependency's *deployed* scope by matching this stored `value` against its `oauth2PermissionScopes`
 * once that dependency itself has been deployed for the same environment (see UC040's sequencing
 * rule for `Dependencies`).
 *
 * Keyed directly by the exact `resourceAppId` string that would appear in that row's own dropdown
 * (the Microsoft Graph GUID, or a dependency's `{{ dependency_refs.<key>.applicationId }}`
 * reference), so a lookup from either the initial render or the webview's own live-refresh script
 * is a single, direct property access with no re-parsing needed.
 */
export async function buildPermissionOptionsByResourceAppId(
  store: ApplicationStore,
  dependencies: Record<string, DependencyEntry>
): Promise<Record<string, PermissionOption[]>> {
  const result: Record<string, PermissionOption[]> = {};

  const graphResource = getWellKnownResourceApplication(MICROSOFT_GRAPH_APP_ID);
  if (graphResource) {
    result[MICROSOFT_GRAPH_APP_ID] = Object.entries(graphResource.permissions)
      .map(([id, permission]) => ({ id, label: permission.name, type: permission.type }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const root = getApplicationsRootUri();
  if (!root) {
    return result;
  }

  await Promise.all(
    Object.entries(dependencies).map(async ([key, dependency]) => {
      if (!dependency.AppName) {
        return;
      }
      let options: PermissionOption[] = [];
      try {
        const files = await store.load(vscode.Uri.joinPath(root, dependency.AppName));
        // The stored `id` here is the scope's own `value` (its human-readable name, e.g.
        // "access_as_user") rather than its GUID — see this function's doc comment for why.
        options = files.application.oauth2PermissionScopes
          .filter((scope) => scope.value)
          .map((scope) => ({ id: scope.value, label: scope.value, type: 'Scope' as const }));
      } catch {
        // A broken/unreadable dependency file shouldn't break this application's own editor —
        // it just contributes no Permission ID options for that dependency's resourceAppId.
      }
      if (options.length > 0) {
        result[buildDependencyReference(key)] = options;
      }
    })
  );

  return result;
}
