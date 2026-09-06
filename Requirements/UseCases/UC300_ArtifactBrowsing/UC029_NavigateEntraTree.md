# UC029 — Navigate the Entra Tree

## Overview

This use case details the shape of the single tree control the extension presents in its "Entra" activity bar container, and how a user moves through it to reach any artifact — remote or local. It is the umbrella use case that [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md), [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md), and [UC041 — Browse Application Definitions](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md) each describe one branch of.

## Actors

* **User**
* **Extension**

## Preconditions

* The extension is activated and its "Entra" view is visible in the activity bar.

## Main Flow

1. User opens the Entra view. The tree shows exactly two top-level nodes, both **expanded by
   default** (as is **Project**'s own **Applications** node) so the saved connections and the local
   application definitions are visible immediately, without expanding anything:
   * **Connections**
   * **Project**

   (After the first session this is subject to A4's persisted expand/collapse state — the default
   only applies until the user changes it.)
2. Expanding **Connections** lists every saved connection (see [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md)) as a child node, labelled with its friendly name (e.g. "Tenancy 1") and an icon indicating whether it is currently connected or not.
3. Expanding a connection node shows the fixed set of artifact-category folder nodes for that tenant: App Registrations, Service Principals, Groups, Directory Roles, External ID User Flows, External ID Custom Authentication Extensions (see [UC030](UC030_BrowseTenantArtifacts.md)). **Implemented so far**: only a *connected* connection is expandable at all, and only shows a single **Applications** folder (App Registrations); the other five categories, and auto-authenticating a disconnected connection on expand (A1 below), remain unimplemented.
4. Expanding a category folder shows one artifact-detail item per object in that category. **Implemented differently for Applications**: the **Applications** folder groups its contents by logical environment — one **Environment: &lt;name&gt;** grouping node per distinct `Environment:<name>` tag found on an application's Service Principal (see [UC030](UC030_BrowseTenantArtifacts.md) A5 and [UC042](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md)'s Generated tags convention), each expanding to the applications in that environment; applications whose Service Principal carries no such tag (or that have no Service Principal) are listed directly under the folder, after the groups.
5. Expanding **Project** currently shows one fixed node, **Applications** (see [UC041 — Browse Application Definitions](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md)); the same fixed set of artifact-category folder nodes described for Connections, scoped to the local project structure, lands alongside it once downloading is implemented (see [UC033](UC033_ViewLocalProjectArtifacts.md)).
6. Expanding **Applications** lists each application definition — one child node per subfolder of `<artifactsRoot>/Applications/` (see [UC040](../UC400_ApplicationManagement/UC040_DefineApplication.md)/[UC041](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md)).
7. An application node is a **leaf**, not a folder — it has no expand arrow and does not list its four backing files as separate children (an earlier version of this tree did; see [UC041](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md) for why that was removed). Clicking it opens a structured, editable Custom Editor tab over all four of its files — see [UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md) — with VS Code's native unsaved-changes indicator and save/revert/close behavior, the same as any other file. Its context menu's **Open as Document** command opens a second, text-based editing surface instead: the same four files combined into one normal, savable document (see UC041/UC042) — not UC042's structured tab, and not the shared artifact-viewer webview from step 9 below, since these are hand-authored source files, not a Graph snapshot.
8. Expanding a downloaded-artifact category folder under **Project** (once implemented) shows one artifact-detail item per matching local file (see [UC033](UC033_ViewLocalProjectArtifacts.md)).
9. Selecting an artifact-detail item — under a connection (Connections side), or a downloaded artifact under **Project** — opens it in the shared artifact-viewer webview (see [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md) for the Connections side, [UC033](UC033_ViewLocalProjectArtifacts.md) for the Project side). This does not apply to application-definition files (step 7). **Implemented for the Connections side, scoped to Applications**: selecting an application item under a connection's Applications folder previews it — see [UC034](UC034_PreviewApplicationArtifact.md). The Project side (UC033) remains unimplemented.

## Alternate Flows

### A1 — Expanding a disconnected connection

1. User expands a connection node that has no valid cached token.
2. [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) runs before the node's category folders are shown; if authentication fails or is cancelled, the node collapses back to its disconnected state rather than showing an empty/broken expansion.
3. **Not implemented.** A disconnected connection is currently a leaf node with no expand affordance at all — the user must run `entra.connect` on it explicitly (via its context menu or inline icon) before its Applications folder appears.

### A2 — Empty states

1. **Connections** has no children yet (no connections saved). The extension shows a single inline affordance under it (e.g. "+ Add Connection") that runs [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md), rather than leaving the node silently empty.
2. **Applications** has no children yet (`<artifactsRoot>/Applications/` doesn't exist, or exists but has no subfolders). The extension shows an explanatory placeholder (e.g. "No applications defined yet") rather than an unexplained empty node — see [UC041](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md).
3. An application node has no files in its folder. The extension shows an explanatory placeholder (e.g. "No files in this application yet") under it, the same principle as above.
4. A category folder, under either root, that has no items is still shown (not hidden) so the user knows that category was checked and is simply empty.

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

* Every artifact or application definition the extension knows about — whether live in a tenant, already downloaded, or locally authored — is reachable through this one predictable hierarchy: root → (connection | Project) → category folder → detail (with, under a connection's Applications folder, an optional environment-grouping node between the folder and the detail — see step 4).

## Related

* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md)
* [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md)
* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)
* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)
* [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md)
* [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md)
* [UC035 — Download an Application Artifact to the Project](UC035_DownloadApplicationArtifact.md)
* [UC041 — Browse Application Definitions](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md)
* [UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md)
