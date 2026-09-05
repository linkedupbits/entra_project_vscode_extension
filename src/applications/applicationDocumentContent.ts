import * as YAML from 'yaml';
import {
  ApplicationFiles,
  normalizeAppConfig,
  normalizeApplicationFields,
  normalizeFederatedCredentials,
  normalizeServicePrincipalFields,
  serializeApplication,
  serializeServicePrincipal,
} from './types';

/**
 * Builds the combined, editable YAML text for a project application's virtual document (see
 * `applicationDocumentUri.ts`) — one YAML document with a top-level key per one of UC040's four
 * files, each holding exactly the same shape `ApplicationStore` reads/writes for that file, so
 * this document's text matches what a developer would see opening the four real files directly.
 *
 * Round-tripping through this text and back accepts the same comment/anchor/unmodelled-field loss
 * UC042's structured editor already does, for the same reason (see UC042's Postconditions) — this
 * is a second editing surface over the same on-disk format, not a new one with different rules.
 */
export function buildApplicationDocumentText(files: ApplicationFiles): string {
  return YAML.stringify({
    AppConfig: files.appConfig,
    Application: serializeApplication(files.application),
    FederatedCredentials: files.federatedCredentials,
    ServicePrincipal: serializeServicePrincipal(files.servicePrincipal),
  });
}

export type ParseApplicationDocumentResult = { kind: 'ok'; files: ApplicationFiles } | { kind: 'error'; message: string };

/**
 * Parses a saved virtual document's text back into `ApplicationFiles`. A missing/malformed
 * top-level key is tolerated the same way `ApplicationStore.load()` tolerates a missing file
 * (falls back to that section's empty defaults) — but text that isn't valid YAML at all can't be
 * interpreted as any of the four sections, so that's reported as an error instead of silently
 * discarding the user's edit.
 */
export function parseApplicationDocumentText(text: string): ParseApplicationDocumentResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return {
    kind: 'ok',
    files: {
      appConfig: normalizeAppConfig(obj.AppConfig),
      application: normalizeApplicationFields(obj.Application),
      federatedCredentials: normalizeFederatedCredentials(obj.FederatedCredentials),
      servicePrincipal: normalizeServicePrincipalFields(obj.ServicePrincipal),
    },
  };
}
