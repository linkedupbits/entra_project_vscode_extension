# UC041 — Browse Application Definitions

## Overview

This use case details how a user browses the application definitions already present in the local project structure (see [UC040 — Define an Application](UC040_DefineApplication.md)), under the **Applications** node of the Entra tree (see [UC029 — Navigate the Entra Tree](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md)). It is the read/browse counterpart to UC040's format specification — this use case covers looking at what's there; the two ways to actually open an application's details are [UC042 — View Application Details](UC042_ViewApplicationDetails.md) (a structured Custom Editor tab) and opening it as a combined document (covered below). Neither this use case, UC042, nor the combined-document path covers creating, validating, rendering, or deploying an application definition, all of which remain UC040's explicitly deferred open questions.

Like [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md), this requires no connection, no authentication, and works fully offline — everything here is reading the local filesystem.

**An application node is a leaf, not a folder it expands to browse.** An earlier version of this use case had expanding an application list its four backing files individually, each opening as its own raw document; that was removed in favor of always reaching an application's content through one of the two paths in step 3 below, rather than needing to know which of four separate files holds what you're looking for.

## Actors

* **User**
* **Extension**

## Preconditions

* A VS Code workspace is open. `<artifactsRoot>/applications/` (root folder configurable via `entra.artifactsRootFolder`, default `entra/`) may or may not yet exist — an absent or empty folder is a valid, empty state, not an error.

## Main Flow

1. User expands the **Applications** node under **Project** in the Entra tree.
2. The extension lists every subfolder of `<artifactsRoot>/applications/` as a child node, one per application definition, labelled with the folder name — sorted alphabetically. Anything in that folder that isn't a directory (a stray file) is ignored. Each application node is a leaf — it has no disclosure triangle and does not expand.
3. User reaches an application's content one of two ways:
   * Clicking the node (its default action) opens [UC042 — View Application Details](UC042_ViewApplicationDetails.md)'s Custom Editor tab for it — a genuine VS Code editor tab (not a plain webview panel), so it shows VS Code's native unsaved-changes indicator and participates in native save/revert/close, the same as any other file.
   * Running **Open as Document** from the node's context menu (`entra.openApplicationDocument`) opens a single, normal, savable VS Code editor tab showing all four of UC040's files combined into one YAML document (one top-level key per file: `AppConfig`, `Application`, `FederatedCredentials`, `ServicePrincipal`) — a second, text-based editing surface over the exact same files UC042 edits, not a separate or lesser copy of them. Editing this document and saving it (Ctrl+S, like any other file) writes all four files back through the same `ApplicationStore` UC042's Save uses, so a change made here is immediately reflected if UC042's tab for the same application is reopened afterward, and vice versa. This is useful for edits more naturally made as text (e.g. pasting in a larger block of YAML, or making the same small edit across several sections at once) without going through the structured form.

## Alternate Flows

### A1 — No applications defined yet

1. `<artifactsRoot>/applications/` doesn't exist, or exists but has no subfolders.
2. The extension shows a single explanatory placeholder under **Applications** (e.g. "No applications defined yet") rather than leaving the node silently empty. The placeholder carries no action — there is no `entra.addApplication` command yet (see [UC040](UC040_DefineApplication.md)'s open questions).

### A2 — Files added, removed, or edited externally

1. A file or folder under `<artifactsRoot>/applications/` is created, deleted, or renamed outside the extension (e.g. via git operations, another editor, or manual copy).
2. The tree reflects the change the next time the affected node is expanded or refreshed; this use case does not specify live file-watching (contrast [UC033](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md) A1, which does) — revisit if that gap proves to matter in practice.

### A3 — Saving the combined document with invalid YAML

1. The user edits the combined document from step 3 into something that isn't valid YAML at all, then saves.
2. The save is rejected with an error (VS Code shows the underlying message) and none of the four files are written — the same "refuse rather than write something misleading" principle UC035 A2 applies to an incomplete preview. A top-level key that's missing or doesn't match one of the four expected shapes is tolerated instead (defaults to that section's empty shape), the same way `ApplicationStore.load()` tolerates a missing file; only genuinely invalid YAML is rejected.

## Postconditions

* The user can see every application definition currently in the project, and open the structured details or the combined document for any of them, without needing network access, authentication, or any deploy tooling to exist.
* Saving the combined document leaves all four files satisfying UC040's format, with the same comment/anchor/unmodelled-field loss UC042's Postconditions already document and accept — this is the same parse-and-rewrite approach, not a stricter or looser one.

## Related

* [UC040 — Define an Application](UC040_DefineApplication.md) — defines the file format and folder structure this use case reads; also the source of the open questions this use case deliberately does not resolve (creation, validation, rendering, deployment).
* [UC042 — View Application Details](UC042_ViewApplicationDetails.md) — what clicking an application node opens, and the source of the comment/anchor/unmodelled-field loss the combined document shares.
* [UC029 — Navigate the Entra Tree](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md) — the overall tree this is part of.
* [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md) — the closest existing precedent (local, offline browsing of the project structure), diverging deliberately on file-watching (A2).
