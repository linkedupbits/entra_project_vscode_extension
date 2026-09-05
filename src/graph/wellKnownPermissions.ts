import wellKnownMicrosoftGraphPermissions from './wellKnownPermissions/microsoftGraph.json';

export const MICROSOFT_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

interface WellKnownPermission {
  name: string;
  type: 'Role' | 'Scope';
}

interface WellKnownPermissionsFile {
  resourceAppId: string;
  displayName: string;
  /** 'public-catalogue' (default, no credentials) or 'tenant' (--from-tenant) — see the script. */
  source: 'public-catalogue' | 'tenant';
  generatedAt: string;
  permissions: Record<string, WellKnownPermission>;
}

/**
 * The JSON import's inferred type widens `type` to `string` (JSON has no literal-type syntax) —
 * asserted back to the narrower shape here, once, rather than losing that narrowing at every call
 * site. This is build-time, checked-in data (seed or script-generated), not user input.
 */
const catalogues: readonly WellKnownPermissionsFile[] = [wellKnownMicrosoftGraphPermissions as WellKnownPermissionsFile];

/**
 * Maps a `RequiredPermission`'s opaque `(resourceAppId, id)` pair to a human-readable name (e.g.
 * `('00000003-0000-0000-c000-000000000000', '7ab1d382-f21e-4acd-a863-ba3e13f7da61')` →
 * `'Directory.Read.All'`), for display only — this never affects what's saved to disk. Only
 * Microsoft Graph is covered today; an unrecognised resourceAppId or id returns undefined rather
 * than guessing.
 *
 * Regenerate the backing data with `npm run download:graph-permissions` (see
 * `scripts/downloadGraphPermissions.js` — no credentials needed by default) rather than
 * hand-editing the checked-in JSON file.
 */
export function describeRequiredPermission(resourceAppId: string, id: string): string | undefined {
  const catalogue = catalogues.find((c) => c.resourceAppId === resourceAppId);
  return catalogue?.permissions[id]?.name;
}
