# UC032 — Preview Artifact Before Download

## Overview

This use case details how a user views the full contents of a remote Entra artifact, in the same YAML representation it would be downloaded as, without writing anything to the local project structure. It uses the same shared artifact-viewer webview as [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md), so a remote (pre-download) artifact and a local (already-downloaded) one look and behave identically when viewed — the only difference is a small source badge indicating where the content came from.

**Implementation status:** this is the generic specification, covering every artifact category and
the eventual `_meta` block/download/compare-with-local behavior below. What's actually built today
is scoped to one artifact category (Applications) and is documented separately as
[UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md), so this document
doesn't need rewriting each time another category gains preview support — see UC034 for exactly
what differs from the flow below.

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The user is browsing an authenticated connection (see [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)).

## Main Flow

1. User selects an artifact-detail item under a connection in the Entra tree and runs `entra.previewArtifact` (context menu, command palette, or default double-click action).
2. The extension fetches the full object for that artifact from Microsoft Graph, if not already fully loaded.
3. The extension serializes the object to YAML in memory (same logic as [UC020](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md), including the `_meta` block) and passes it to the shared artifact-viewer webview, which shows/reuses a single `WebviewPanel`, titled with the artifact's display name and badged "Connection: `<connection name>`".
4. The user reads/reviews the content. The webview is read-only by construction — it is a viewer, not an editor; there is no path from this panel back to the tenant or to a local file.
5. If the user decides to keep it, they run `entra.downloadArtifact` from the viewer, proceeding to [UC031 — Download Artifact](UC031_DownloadArtifact.md).

## Alternate Flows

### A1 — Preview an already-downloaded artifact

1. The user opens a preview for an artifact that already has a corresponding local file.
2. The extension offers a "Compare with local file" action alongside the viewer. Unlike the viewer itself, this opens VS Code's built-in (text-based) diff editor between a virtual document of the remote content and the local YAML file — the diff editor cannot operate on webview content, so this is the one place a separate, text-based mechanism is used deliberately (the local file's hand-added comments will show as diff-only lines, since the remote side never contains user comments).

### A2 — Fetch fails

1. Microsoft Graph returns an error while fetching the full object.
2. The extension surfaces an error notification; no preview tab is opened.

## Postconditions

* No file is created or modified in the local project structure as a result of previewing alone.
* The user has enough information to decide whether to download the artifact.

## Related

* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md) — precondition.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — the natural next step.
* [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md) — the currently-implemented instance of this use case, scoped to Applications.
