import wellKnownMicrosoftGraphPermissions from './wellKnownPermissions/microsoftGraph.json';
import { GraphResourceApplication, GraphResourcePermission } from './graphClient';

export const MICROSOFT_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

interface WellKnownPermissionsFile {
  resourceAppId: string;
  displayName: string;
  /** 'public-catalogue' (default, no credentials) or 'tenant' (--from-tenant) — see the script. */
  source: 'public-catalogue' | 'tenant';
  generatedAt: string;
  permissions: Record<string, GraphResourcePermission>;
}

/**
 * The JSON import's inferred type widens `type` to `string` (JSON has no literal-type syntax) —
 * asserted back to the narrower shape here, once, rather than losing that narrowing at every call
 * site. This is build-time, checked-in data (script-generated), not user input.
 */
const catalogues: readonly WellKnownPermissionsFile[] = [wellKnownMicrosoftGraphPermissions as WellKnownPermissionsFile];

/**
 * Looks up a resource application's display name and permission catalogue from the checked-in,
 * regeneratable data (see `scripts/downloadGraphPermissions.js` — no credentials needed by
 * default) — the well-known, static counterpart to `graphClient.ts`'s
 * `getResourceApplicationPermissions()`, which does the same lookup at runtime via Graph for any
 * *other* resource application. Only Microsoft Graph is covered here; an unrecognised
 * resourceAppId returns undefined rather than guessing, so callers fall back to a live lookup.
 *
 * Regenerate the backing data with `npm run download:graph-permissions` rather than hand-editing
 * the checked-in JSON file.
 */
export function getWellKnownResourceApplication(resourceAppId: string): GraphResourceApplication | undefined {
  const catalogue = catalogues.find((c) => c.resourceAppId === resourceAppId);
  return catalogue ? { displayName: catalogue.displayName, tags: [], permissions: catalogue.permissions } : undefined;
}
