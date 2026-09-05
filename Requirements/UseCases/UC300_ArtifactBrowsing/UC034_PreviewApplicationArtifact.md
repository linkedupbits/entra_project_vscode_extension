# UC034 — Preview an Application Artifact

## Overview

This use case is the currently-implemented instance of [UC032 — Preview Artifact Before
Download](UC032_PreviewArtifactBeforeDownload.md), scoped to the one artifact category UC030
implements today: **Applications** (App Registrations) under a connected connection. UC032 stays
the generic specification for previewing *any* artifact category, including behavior (the `_meta`
block, "Compare with local file") this use case doesn't implement yet; this document describes
only what actually happens for an application, and exists separately so UC032 isn't rewritten to
describe one category's specifics while still standing for the general case.

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The user has expanded a connected connection's **Applications** folder (see [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)), so at least one application item is visible.

## Main Flow

1. User selects an application item under a connection's **Applications** folder.
2. The extension fetches that application's full representation from Microsoft Graph
   (`GET /v1.0/applications/{id}`) — every field, not just the `id`/`appId`/`displayName` subset
   UC030's listing call selects — showing a progress notification while the request is in flight.
   Graph's own `@odata.context` response metadata is stripped before display, since it describes
   the response shape rather than the application itself.
3. The extension serializes the result to YAML and shows it in a read-only webview panel
   (`ArtifactViewerPanel`), titled with the application's display name (or its application ID if
   display name is blank) and badged "Connection: `<connection name>`".
4. The user reads the content. The panel has no editable fields, no buttons, and no path back to
   the tenant or to a local file — it is a viewer only.
5. Selecting the same application again while its panel is still open brings that existing panel
   forward (and refreshes its content with a fresh Graph fetch) rather than opening a duplicate,
   keyed by connection name + object ID.

## Alternate Flows

### A1 — Fetch fails

1. Microsoft Graph returns an error (e.g. a transient failure, or a permission the connection's
   token lacks) while fetching the full object.
2. The extension shows an error notification naming the application and the underlying message; no
   preview panel is opened (or, if one was already open for a different application, it is left
   untouched).

## Postconditions

* No file is created or modified in the local project structure as a result of previewing alone.
* The user has enough information to decide whether the application is the one they were looking
  for — deciding to download it, or comparing it with a local file, are both out of scope (see
  Related).

## Not implemented (deferred to UC032/UC031/UC033 once those exist)

* The `_meta` block (source connection, tenant ID, Graph endpoint/API version, fetch timestamp)
  UC020/UC032 describe — the preview shows only the raw Graph object.
* "Compare with local file" (UC032 A1) — there's no downloaded-artifact concept yet to compare
  against.
* A "Download" action from the panel (UC031) — downloading isn't implemented.
* Previewing any category other than Applications — the other five UC030 lists remain
  unimplemented, so there's nothing else to preview yet.

## Related

* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md) — the generic use case this implements one instance of.
* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md) — how the user reaches the previewed item.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — the deferred next step.
* [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md) — the deferred local-file side of the shared viewer.
