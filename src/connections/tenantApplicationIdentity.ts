const APP_NAME_TAG_PREFIX = 'AppName:';
const ENVIRONMENT_TAG_PREFIX = 'Environment:';

export interface TenantApplicationIdentity {
  environment: string;
  businessUnit: string;
  appName: string;
}

/**
 * What `downloadApplicationToProject()` actually needs — broader than `TenantApplicationIdentity`
 * because UC035 A4's fallback wizard (`promptForApplicationName.ts`) only ever collects `appName`
 * when there's no tag to parse the other two from. A full `TenantApplicationIdentity` satisfies
 * this structurally (its two extra fields are required, which is stricter than optional), so
 * `parseTenantApplicationIdentity()`'s result can be passed anywhere this type is expected without
 * change. When `environment`/`businessUnit` are absent, `downloadApplicationToProject()` simply
 * skips the AppConfig.yaml merge steps that need them, rather than guessing or inventing
 * placeholder values for a live tenant's actual environment/business unit.
 */
export interface ApplicationDownloadTarget {
  appName: string;
  environment?: string;
  businessUnit?: string;
}

/**
 * Parses the `AppName:<Environment>_<BusinessUnit>_<AppName>` tag UC042's Generated tags preview
 * describes (see `applicationEditorHtml.ts`'s `updateGeneratedTags()`) back into its three parts,
 * from a Service Principal's real, deployed `tags` list — this is how UC034/UC035 identify which
 * local application-definition folder a tenant application corresponds to, and which environment
 * it represents. When this returns undefined, UC035 A4 falls back to asking the user directly
 * (see `promptForApplicationName.ts`) rather than refusing to download.
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

/**
 * Whether the Service Principal also carries a separate `Environment:` tag (UC042's Generated
 * tags preview's second tag) alongside `AppName:` — used by `downloadApplicationToProject()` as a
 * signal that this Service Principal was deployed through the full tagging convention, not just
 * hand-given an `AppName:` tag, before it trusts connection-derived values for a newly-created
 * Environment entry's `publisherDomain`/`tenancy_type`. The tag's own value isn't inspected —
 * its value may still be the literal, unresolved `{{Environment}}` placeholder (see UC040), so
 * only its presence is meaningful here, not its content.
 */
export function hasEnvironmentTag(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.startsWith(ENVIRONMENT_TAG_PREFIX));
}
