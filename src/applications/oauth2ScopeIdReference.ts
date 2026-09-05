const ENVIRONMENT_VARIABLE_ID_PATTERN = /^\{\{\s*environment\.Variables\.(.+?)\s*\}\}$/;

/**
 * UC042's Exposed API scopes rows let a user author a scope's `id` as a per-environment Jinja
 * variable reference (`{{ environment.Variables.<name> }}`) instead of typing a raw GUID directly —
 * useful since Graph requires *a* GUID-shaped id but doesn't care which one, so a project can park
 * the actual value in each environment's `Variables` map (see `AppConfig.yaml`'s `Variables`,
 * UC040) and reference it by name here, the same templating idea `dependency_refs` already uses
 * for `resourceAppId` (see `resourceAppIdReference.ts`). Parsing only recognises this one exact
 * shape; anything else (a raw GUID, blank, or arbitrary text) isn't rewritten — see
 * `resolveOauth2PermissionScopes` in `applicationFormLogic.ts` for how the two cases are
 * reconciled so an existing raw id is never silently overwritten by a blank variable name.
 */
export function parseEnvironmentVariableIdName(id: string): string | undefined {
  return ENVIRONMENT_VARIABLE_ID_PATTERN.exec(id)?.[1];
}

/** Builds the exact `id` string the editor writes when an "ID variable name" is given. */
export function buildEnvironmentVariableIdReference(variableName: string): string {
  return `{{ environment.Variables.${variableName} }}`;
}
