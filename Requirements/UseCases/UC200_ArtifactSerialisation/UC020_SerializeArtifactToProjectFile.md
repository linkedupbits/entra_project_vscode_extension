# UC020 — Serialize Artifact to Project File

## Overview

This use case details how a single Entra artifact, once retrieved from Microsoft Graph, is written into the local project structure as a file the user can browse, hand-edit, and commit to source control. This is a read-only-ish snapshot of what's already deployed — for the separate, locally-authored-for-deployment concept, see [UC040 — Define an Application](../UC400_ApplicationManagement/UC040_DefineApplication.md).

## Actors

* **Extension**
* **User** — as the eventual reader/editor of the resulting file.

## Preconditions

* The workspace has an artifacts root folder (`entra/` by default, configurable via `entra.artifactsRootFolder`).
* A Graph object for the artifact has already been retrieved (see [UC031 — Download Artifact](../UC300_ArtifactBrowsing/UC031_DownloadArtifact.md)).

## Main Flow

1. The extension determines the artifact's category sub-folder from its Graph type:
   * `application` → `appRegistrations/`
   * `servicePrincipal` → `servicePrincipals/`
   * `group` → `groups/`
   * `directoryRole` → `directoryRoles/`
   * `b2cUserFlow` / CIAM user flow → `externalId/userFlows/`
   * `customAuthenticationExtension` → `externalId/customAuthExtensions/`
2. The extension derives a filename of the form `<displayName>__<id>.yaml`, sanitising `displayName` to remove characters that are invalid in a filesystem path. `id` is the artifact's immutable Graph object ID (or `appId` for applications), guaranteeing uniqueness even if two artifacts share a display name.
3. The extension serializes the raw Graph object to YAML (not JSON — see `NonFunctionalRequirements.md`) using a library such as `js-yaml`.
4. The extension prepends/attaches a `_meta` block to the serialized document recording:
   * `sourceConnection` — the connection name the artifact was downloaded from
   * `tenantId` — the tenant ID of that connection
   * `graphEndpoint` — the Graph resource path and API version used to retrieve it (e.g. `/v1.0/applications/{id}`)
   * `downloadedAt` — an ISO-8601 UTC timestamp
5. The extension writes the resulting YAML document to `<root>/<category>/<filename>`, creating parent folders as needed.

## Alternate Flows

### A1 — File already exists (re-download)

1. A file at the computed path already exists, e.g. because it was downloaded previously or an update has occurred, and hand-edited comments may be present.
2. The extension prompts the user to confirm overwrite (default), or to view a diff before overwriting, or to cancel. Hand-authored YAML comments in the existing file are not merged automatically and will be lost on overwrite unless the user cancels.

### A2 — Sanitisation collision

1. Two artifacts of the same type sanitise to the same `displayName` segment (e.g. differing only by characters stripped during sanitisation).
2. Since the filename also includes the immutable `id`, the resulting filenames remain distinct; no collision occurs.

## Postconditions

* A single YAML file exists under the artifacts root representing the artifact's state at download time, including provenance metadata sufficient to identify where it came from and when.
* The file is visible under the **Project** node of the Entra tree (see [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md)).

## Related

* [UC031 — Download Artifact](../UC300_ArtifactBrowsing/UC031_DownloadArtifact.md) — triggers this use case.
* [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md) — consumes its output.
* [UC040 — Define an Application](../UC400_ApplicationManagement/UC040_DefineApplication.md) — the distinct, deployable-definition counterpart; how the two relate is an open question there, not resolved here.
