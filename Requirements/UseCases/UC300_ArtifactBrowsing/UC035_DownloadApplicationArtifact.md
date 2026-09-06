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

* The user has UC034's preview panel open for an application, with its Application, Federated
  Credentials, and Service Principal sections all loaded successfully.
* A workspace folder is open (needed to resolve `<artifactsRoot>/Applications/`).

Unlike an earlier version of this use case, a tenant `AppName:` tag is **not** a precondition —
see step 2 and A4 below. The **Download to project** button is always present once the
preconditions above are met.

## Main Flow

1. From an open preview panel meeting the preconditions above, the user selects **Download to
   project**.
2. The extension looks for a tag starting with `AppName:` on the Service Principal whose value
   splits into exactly three non-blank, underscore-separated parts —
   `<Environment>_<BusinessUnit>_<AppName>` (see `tenantApplicationIdentity.ts`'s
   `parseTenantApplicationIdentity()`, and UC042's Generated tags preview, which describes this as
   one of four tags a real deploy is expected to apply automatically). If found, `<AppName>`,
   `<BusinessUnit>`, and `<Environment>` are used as below. If not found, A4 below applies instead.
3. The extension resolves the target folder as `<artifactsRoot>/Applications/<AppName>/` — the
   same folder UC040/UC041/UC042 already use for that application name, created if it doesn't
   exist yet.
4. The extension loads whatever already exists in that folder (tolerating any or all of the four
   files being absent, exactly as UC042 does) and merges in the previewed data, **non-destructively**:
   * `AppConfig.yaml`'s `application_name` is set to `<AppName>` only if currently blank.
   * `AppConfig.yaml`'s `business_unit` is set to `<BusinessUnit>` only if currently blank and
     `<BusinessUnit>` is known (it isn't, under A4).
   * If `<Environment>` is known (it isn't, under A4), an entry is appended to `AppConfig.yaml`'s
     `Environments` list for it (as both `name` and `environment_code`) only if no entry with that
     `environment_code` already exists; an existing one is left untouched. See A5 below for how
     that new entry's `publisherDomain`/`tenancy_type` are populated. The previewed application's
     redirect URIs are seeded into that new entry's `Variables` as array values (`web_redirectUris`
     / `publicClient_redirectURIs` / `spa_redirectURIs` — the keys UC042 defines for per-environment
     redirect URIs), each omitted when the tenant application has none of that category.
   * Each of `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and `ServicePrincipal.yaml.j2`
     is written with the previewed data **only if that file doesn't already exist**. An existing
     file — which may be a hand-authored Nunjucks template with real `{{ }}` placeholders — is
     never overwritten with the concrete, resolved values a live tenant capture produces; doing so
     would silently destroy the templating UC040 depends on.
   * The Service Principal's `tags` are filtered before being written into
     `ServicePrincipal.yaml.j2` (only when that file doesn't already exist — see above): any tag
     starting with `AppName:`, `Environment:`, or `BusinessUnit:`, and any tag exactly equal to
     `<AppName>` (the bare-name fourth tag UC042's Generated tags preview describes), are dropped.
     These four are the ones a real deploy is expected to (re)apply automatically; saving them as
     if they were hand-typed custom tags would make the file fail UC042's own reserved-prefix
     validation (see [UC042 A2](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md))
     the next time it's opened and saved there. Every other tag is kept unchanged.
5. The extension writes the result (the same way UC042's Save does) and shows a confirmation
   notification naming the application and its folder, and refreshes the **Project** node of the
   Entra tree so the (possibly new) local application definition is immediately visible.

## Alternate Flows

### A1 — No workspace folder is open

1. Preconditions aren't met: there's nowhere to resolve `<artifactsRoot>/Applications/` against.
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

### A4 — No AppName tag found

1. The Service Principal has no tag matching the `AppName:` pattern step 2 describes — the
   application predates the tagging convention, or was never deployed through it.
2. Rather than refusing to download, the extension prompts the user with an input box: "No unique
   name tag was found on this application. Enter the application name to save it as." Submitting a
   non-blank value continues the main flow from step 3 using that value as `<AppName>`, with
   `<BusinessUnit>` and `<Environment>` both unknown — the `business_unit`-fill and
   `Environments`-entry steps in step 4 are skipped entirely, not filled with guessed or blank
   placeholder values. Cancelling the prompt (Esc, or leaving it blank) aborts the download
   silently, the same as cancelling any other quick input in this extension — no error
   notification, since nothing was requested.

### A5 — Enriching a new Environment entry from the connection

1. `<Environment>` is known (i.e. A4 did not apply) and step 4 is about to append a new
   `Environments` entry for it, and the Service Principal also carries a separate tag starting
   with `Environment:` (UC042's Generated tags preview's second tag — its value isn't inspected,
   only its presence, since it may still be the literal unresolved `{{Environment}}` placeholder).
2. The new entry's `publisherDomain` is set from the previewed Application's own Graph
   `publisherDomain` field (fetched as part of UC034's Application call, though not itself part of
   the structured Application section UC042 models), and its `tenancy_type` is set to `ciam` if
   the connection being downloaded from has `tenantKind: 'externalId'`, or `workforce` otherwise.
   This is the one place this use case reads anything from the connection itself, rather than
   purely from the previewed data or the parsed tag.
3. If the Service Principal has no `Environment:` tag, the new entry's `publisherDomain` and
   `tenancy_type` are left blank instead — the original behavior, unchanged when this additional
   signal isn't present.

## Postconditions

* `<artifactsRoot>/Applications/<AppName>/` exists and satisfies UC040's format, with the
  downloaded environment represented in `AppConfig.yaml`'s `Environments` list, if `<Environment>`
  was known (A4 not applying).
* No existing hand-authored file in that folder was overwritten.
* `ServicePrincipal.yaml.j2`'s `tags` (when written) never contain any of the four
  automatically-generated tags UC042's Generated tags preview describes.
* The **Project** node of the Entra tree reflects the result.

## Related

* [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md) — where the Download button lives, and the source of the previewed data this writes.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — the generic use case this deliberately does *not* follow the flat-snapshot shape of; see Overview.
* [UC040 — Define an Application](../UC400_ApplicationManagement/UC040_DefineApplication.md) — defines the folder/file format this writes into, and whose open question this resolves for Applications.
* [UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md) — the structured editor a downloaded application can subsequently be opened in, and the source of the reserved-tag-prefix rule step 4's tag stripping exists to stay compatible with.
* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md) — defines `tenantKind`, the connection field A5 reads to decide `workforce` vs `ciam`.
