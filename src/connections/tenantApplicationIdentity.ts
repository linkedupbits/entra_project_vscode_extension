const APP_NAME_TAG_PREFIX = 'AppName:';

export interface TenantApplicationIdentity {
  environment: string;
  businessUnit: string;
  appName: string;
}

/**
 * Parses the `AppName:<Environment>_<BusinessUnit>_<AppName>` tag UC042's Generated tags preview
 * describes (see `applicationFormPanel.ts`'s `updateGeneratedTags()`) back into its three parts,
 * from a Service Principal's real, deployed `tags` list — this is how UC034/UC035 identify which
 * local application-definition folder a tenant application corresponds to, and which environment
 * it represents.
 *
 * Returns undefined if no tag with this prefix is present, or if its value doesn't split into
 * exactly three non-blank underscore-separated parts. A malformed or ambiguous tag (e.g. one of
 * the three original values itself contained an underscore) is not guessed at — these parts feed
 * a filesystem path, and getting that wrong risks silently writing into the wrong application's
 * folder.
 */
export function parseTenantApplicationIdentity(tags: readonly string[]): TenantApplicationIdentity | undefined {
  const tag = tags.find((t) => t.startsWith(APP_NAME_TAG_PREFIX));
  if (!tag) {
    return undefined;
  }
  const parts = tag.slice(APP_NAME_TAG_PREFIX.length).split('_');
  if (parts.length !== 3 || parts.some((part) => part.trim().length === 0)) {
    return undefined;
  }
  const [environment, businessUnit, appName] = parts;
  return { environment, businessUnit, appName };
}
