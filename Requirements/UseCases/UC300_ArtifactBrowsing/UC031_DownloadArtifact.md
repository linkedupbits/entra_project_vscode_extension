# UC031 — Download Artifact

## Overview

This use case details how a user downloads one or more Entra artifacts from a connected tenant into the local project structure.

**Implementation status:** not implemented for any category as the flat-snapshot flow described
below. Applications have a *different*, implemented download flow —
[UC035 — Download an Application Artifact to the Project](UC035_DownloadApplicationArtifact.md) —
that deliberately does not follow this use case's shape, writing into UC040's richer
application-definition folder instead of a flat snapshot file. See UC035's Overview for why.

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The user is browsing an authenticated connection (see [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)).

## Main Flow (single artifact)

1. User selects an artifact-detail item under a connection in the Entra tree and runs `entra.downloadArtifact` (context menu or command palette).
2. The extension fetches the full object for that artifact from Microsoft Graph, if not already fully loaded (list responses may be partial/selected-fields only).
3. The extension serializes the artifact to the project structure (see [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)).
4. The extension shows a confirmation notification with a link to reveal the written file, and refreshes the **Project** node of the Entra tree.

## Alternate Flows

### A1 — Download all of a category

1. User runs `entra.downloadAllOfType` on a category node (e.g. all App Registrations) rather than a single item.
2. The extension pages through the full Graph listing for that category (handling A1/A2 of [UC030](UC030_BrowseTenantArtifacts.md) as needed), downloading each object in turn.
3. The extension reports a summary notification (e.g. "12 downloaded, 1 skipped, 0 failed") on completion.

### A2 — Artifact already downloaded

1. The target file already exists locally.
2. [UC020](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)'s overwrite-confirmation alternate flow applies. In the "download all" flow (A1), the user is asked once whether to apply the same decision (overwrite/skip) to all remaining conflicts, or be asked per file.

### A3 — Download fails

1. Microsoft Graph returns an error (network failure, throttling exceeded retries, permissions) while fetching the full object.
2. The extension surfaces an error notification for that artifact and continues with any remaining artifacts in a "download all" batch, including it in the failure count.

## Postconditions

* One YAML file per successfully downloaded artifact exists under the artifacts root, each satisfying the postconditions of [UC020](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md).
* The **Project** node of the Entra tree reflects the newly downloaded file(s).

## Related

* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md) — precondition.
* [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md) — performs the actual file write.
* [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md) — where the result becomes visible.
* [UC035 — Download an Application Artifact to the Project](UC035_DownloadApplicationArtifact.md) — the implemented, structurally-different download flow for Applications specifically.
