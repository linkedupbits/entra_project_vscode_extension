import { MICROSOFT_GRAPH_APP_ID } from '../graph/wellKnownPermissions';

export { MICROSOFT_GRAPH_APP_ID };

export type ResourceAppIdChoice = { kind: 'microsoftGraph' } | { kind: 'dependency'; key: string } | { kind: 'unrecognized' };

const DEPENDENCY_REFERENCE_PATTERN = /^\{\{\s*dependency_refs\.(.+?)\.applicationId\s*\}\}$/;

/**
 * UC042's Required Permissions rows store `resourceAppId` as a plain string (see
 * `RequiredPermission` in `types.ts`), but the editor's dropdown only ever writes one of two
 * recognised shapes: the well-known Microsoft Graph application ID, or a
 * `{{ dependency_refs.<key>.applicationId }}` reference to one of this application's own
 * `AppConfig.yaml` Dependencies entries (resolved once deploy tooling exists — see UC040).
 * Anything else — a hand-edited file, a reference to a dependency key since renamed or removed, or
 * a raw third-party GUID this form doesn't model — is `'unrecognized'`, so the caller can fall back
 * to showing it as plain, still-editable text with a warning rather than silently discarding or
 * misrepresenting it.
 */
export function parseResourceAppId(resourceAppId: string, dependencyKeys: readonly string[]): ResourceAppIdChoice {
  if (resourceAppId === MICROSOFT_GRAPH_APP_ID) {
    return { kind: 'microsoftGraph' };
  }
  const match = DEPENDENCY_REFERENCE_PATTERN.exec(resourceAppId);
  const key = match?.[1];
  if (key !== undefined && dependencyKeys.includes(key)) {
    return { kind: 'dependency', key };
  }
  return { kind: 'unrecognized' };
}

/** Builds the exact resourceAppId string the editor's dropdown writes for a Dependencies reference. */
export function buildDependencyReference(key: string): string {
  return `{{ dependency_refs.${key}.applicationId }}`;
}
