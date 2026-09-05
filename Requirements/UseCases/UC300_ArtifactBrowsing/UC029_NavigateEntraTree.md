# UC029 — Navigate the Entra Tree

## Overview

This use case details the shape of the single tree control the extension presents in its "Entra" activity bar container, and how a user moves through it to reach any artifact — remote or local. It is the umbrella use case that [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md) and [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md) each describe one branch of.

## Actors

* **User**
* **Extension**

## Preconditions

* The extension is activated and its "Entra" view is visible in the activity bar.

## Main Flow

1. User opens the Entra view. The tree shows exactly two top-level nodes:
   * **Connections**
   * **Project**
2. Expanding **Connections** lists every saved connection (see [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md)) as a child node, labelled with its friendly name (e.g. "Tenancy 1") and an icon indicating whether it is currently connected or not.
3. Expanding a connection node shows the fixed set of artifact-category folder nodes for that tenant: App Registrations, Service Principals, Groups, Directory Roles, External ID User Flows, External ID Custom Authentication Extensions (see [UC030](UC030_BrowseTenantArtifacts.md)).
4. Expanding a category folder shows one artifact-detail item per object in that category.
5. Expanding **Project** shows the same fixed set of artifact-category folder nodes, this time scoped to the local project structure — no connection or authentication involved.
6. Expanding a category folder under **Project** shows one artifact-detail item per matching local file (see [UC033](UC033_ViewLocalProjectArtifacts.md)).
7. Selecting any artifact-detail item, under either root, opens it in the shared artifact-viewer webview (see [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md) for the Connections side, [UC033](UC033_ViewLocalProjectArtifacts.md) for the Project side).

## Alternate Flows

### A1 — Expanding a disconnected connection

1. User expands a connection node that has no valid cached token.
2. [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) runs before the node's category folders are shown; if authentication fails or is cancelled, the node collapses back to its disconnected state rather than showing an empty/broken expansion.

### A2 — Empty states

1. **Connections** has no children yet (no connections saved). The extension shows a single inline affordance under it (e.g. "+ Add Connection") that runs [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md), rather than leaving the node silently empty.
2. **Project** has no children yet (nothing downloaded, or the artifacts root folder doesn't exist). The extension shows an explanatory placeholder (e.g. "No artifacts downloaded yet") rather than an unexplained empty node.
3. A category folder, under either root, that has no items is still shown (not hidden) so the user knows that category was checked and is simply empty.

### A3 — Already-downloaded indicator

1. User expands a category folder under a connection (**Connections** side) for which one or more of the listed artifacts already have a corresponding local file under **Project**.
2. Those artifact-detail items are decorated (e.g. a badge/icon) to indicate they've already been downloaded, distinguishing them from artifacts not yet present locally, without requiring the user to cross-check the **Project** branch manually.

### A4 — Expand/collapse state persistence

1. User expands some connections/categories, closes VS Code, and reopens the workspace.
2. The tree restores its previous expand/collapse state using VS Code's standard tree-view state memory, so the user doesn't have to re-navigate from scratch every session.

### A5 — Editing a connection's own saved details

1. User clicks a connection node itself (as opposed to expanding it to browse artifacts).
2. The extension opens the Edit Connection webview for it, pre-filled with its current values — the same form and flow as running `entra.editConnection` on it (see [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md), alternate flow A3). Clicking is simply an additional, discoverable trigger for that same flow, not a separate read-only view.

## Postconditions

* Every artifact the extension knows about — whether live in a tenant or already downloaded — is reachable through this one predictable hierarchy: root → (connection | Project) → category folder → artifact detail.

## Related

* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md)
* [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md)
* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)
* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)
* [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md)
