# UC035 — Download an Application Artifact to the Project

## Overview

This use case details the **Download** action available from
[UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md)'s preview panel.

Unlike [UC031 — Download Artifact](UC031_DownloadArtifact.md)'s generic spec — a flat,
per-object-type snapshot file (`<category>/<displayName>__<id>.yaml`, see
[UC020](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)) — this use case
does **not** write a flat snapshot. Applications already have a richer local representation
([UC040 — Define an Application](../UC400_ApplicationManagement/UC040_DefineApplication.md)'s
four-file, per-environment folder), so downloading an application populates *that* structure
instead. This resolves, for the Applications category specifically, the open question UC040 itself
raised ("How does an application definition relate to a downloaded artifact?") — see UC040's
Resolved section. It remains an open question for any other artifact category, which would still
follow UC031's flat-snapshot model if/when implemented.

## Actors

* **User**
* **Extension**

## Preconditions

* The user has UC034's preview panel open for an application, and its Service Principal section
  loaded successfully with at least one tag starting with `AppName:` whose value splits into
  exactly three non-blank, underscore-separated parts —
  `<Environment>_<BusinessUnit>_<AppName>` (see
  `tenantApplicationIdentity.ts`'s `parseTenantApplicationIdentity()`). This is the same tag
  UC042's Generated tags preview describes as being applied automatically by future deploy
  tooling; today it must already be present on the tenant's Service Principal for Download to be
  available at all.
* A workspace folder is open (needed to resolve `<artifactsRoot>/applications/`).

## Main Flow

1. From an open preview panel meeting the preconditions above, the user selects **Download to
   project**.
2. The extension parses the `AppName:` tag into its three parts and resolves the target folder as
   `<artifactsRoot>/applications/<AppName>/` — the same folder UC040/UC041/UC042 already use for
   that application name, created if it doesn't exist yet.
3. The extension loads whatever already exists in that folder (tolerating any or all of the four
   files being absent, exactly as UC042 does) and merges in the previewed data, **non-destructively**:
   * `AppConfig.yaml`'s `application_name` is set to `<AppName>` only if currently blank.
   * `AppConfig.yaml`'s `business_unit` is set to `<BusinessUnit>` only if currently blank.
   * An entry is appended to `AppConfig.yaml`'s `Environments` list for `<Environment>` (as both
     its `name` and `environment_code`, with `publisherDomain`/`tenancy_type` left blank) only if
     no entry with that `environment_code` already exists; an existing one is left untouched.
   * Each of `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and `ServicePrincipal.yaml.j2`
     is written with the previewed data **only if that file doesn't already exist**. An existing
     file — which may be a hand-authored Nunjucks template with real `{{ }}` placeholders — is
     never overwritten with the concrete, resolved values a live tenant capture produces; doing so
     would silently destroy the templating UC040 depends on.
4. The extension writes the result (the same way UC042's Save does) and shows a confirmation
   notification naming the application and its folder, and refreshes the **Project** node of the
   Entra tree so the (possibly new) local application definition is immediately visible.

## Alternate Flows

### A1 — No workspace folder is open

1. Preconditions aren't met: there's nowhere to resolve `<artifactsRoot>/applications/` against.
2. The extension shows an error notification; nothing is written.

### A2 — Part of the preview failed to load

1. One or more of UC034's three Graph calls (Application, Federated Credentials, Service
   Principal) failed, so `AppName:` parsing succeeded (it only needs the Service Principal's
   tags) but the data to write for a failed section isn't trustworthy.
2. The extension refuses to download at all rather than writing a misleadingly-empty file for the
   failed section, and shows an error notification asking the user to reopen the preview and try
   again (a fresh preview reattempts all three calls).

### A3 — Download itself fails

1. Writing to the local filesystem fails (e.g. a permissions issue).
2. The extension shows an error notification with the underlying message; the folder may be left
   partially written (this use case does not attempt to roll back a partial write, the same as
   UC042's Save).

## Postconditions

* `<artifactsRoot>/applications/<AppName>/` exists and satisfies UC040's format, with the
  downloaded environment represented in `AppConfig.yaml`'s `Environments` list.
* No existing hand-authored file in that folder was overwritten.
* The **Project** node of the Entra tree reflects the result.

## Related

* [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md) — where the Download button lives, and the source of the previewed data this writes.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — the generic use case this deliberately does *not* follow the flat-snapshot shape of; see Overview.
* [UC040 — Define an Application](../UC400_ApplicationManagement/UC040_DefineApplication.md) — defines the folder/file format this writes into, and whose open question this resolves for Applications.
* [UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md) — the structured editor a downloaded application can subsequently be opened in.
