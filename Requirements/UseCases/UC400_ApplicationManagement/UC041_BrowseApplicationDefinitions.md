# UC041 — Browse Application Definitions

## Overview

This use case details how a user browses the application definitions already present in the local project structure (see [UC040 — Define an Application](UC040_DefineApplication.md)), under the **Applications** node of the Entra tree (see [UC029 — Navigate the Entra Tree](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md)). It is the read/browse counterpart to UC040's format specification — this use case covers looking at what's there; opening an application's structured details is [UC042 — View Application Details](UC042_ViewApplicationDetails.md), and opening one raw file directly is covered below. Neither this use case nor UC042 covers creating, validating, rendering, or deploying an application definition, all of which remain UC040's explicitly deferred open questions.

Like [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md), this requires no connection, no authentication, and works fully offline — everything here is reading the local filesystem.

## Actors

* **User**
* **Extension**

## Preconditions

* A VS Code workspace is open. `<artifactsRoot>/applications/` (root folder configurable via `entra.artifactsRootFolder`, default `entra/`) may or may not yet exist — an absent or empty folder is a valid, empty state, not an error.

## Main Flow

1. User expands the **Applications** node under **Project** in the Entra tree.
2. The extension lists every subfolder of `<artifactsRoot>/applications/` as a child node, one per application definition, labelled with the folder name — sorted alphabetically. Anything in that folder that isn't a directory (a stray file) is ignored.
3. User clicks an application node (as opposed to expanding its disclosure triangle). The extension opens [UC042 — View Application Details](UC042_ViewApplicationDetails.md)'s structured webview for it — this is the application node's default action, the same "click opens something richer than a plain expand" pattern already used for a connection (see [UC029](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md) A5).
4. User expands an application node instead (or as well — expand and click are independent actions on the same tree item).
5. The extension lists the files found directly inside that application's folder, in UC040's canonical order (`AppConfig.yaml`, `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, `ServicePrincipal.yaml.j2`) followed by any other files present, alphabetically. Subfolders, if any, are ignored. Nothing here assumes an application has all four canonical files — whatever is actually found is what's listed.
6. User selects a file. The extension opens it in the default text editor for that file type (`vscode.open`), exactly as opening any other file in the workspace — directly editable, not a read-only viewer, and not the structured webview from step 3. This remains useful alongside UC042 for direct, low-level edits (e.g. to the Nunjucks templates' raw syntax) without going through a form.

## Alternate Flows

### A1 — No applications defined yet

1. `<artifactsRoot>/applications/` doesn't exist, or exists but has no subfolders.
2. The extension shows a single explanatory placeholder under **Applications** (e.g. "No applications defined yet") rather than leaving the node silently empty. The placeholder carries no action — there is no `entra.addApplication` command yet (see [UC040](UC040_DefineApplication.md)'s open questions).

### A2 — Application folder has no files

1. An application's folder exists but is empty.
2. The extension shows a single explanatory placeholder under that application node (e.g. "No files in this application yet") rather than leaving it silently empty.

### A3 — Files added, removed, or edited externally

1. A file or folder under `<artifactsRoot>/applications/` is created, deleted, or renamed outside the extension (e.g. via git operations, another editor, or manual copy).
2. The tree reflects the change the next time the affected node is expanded or refreshed; this use case does not specify live file-watching (contrast [UC033](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md) A1, which does) — revisit if that gap proves to matter in practice.

## Postconditions

* The user can see, open the structured details of, and open every individual file belonging to every application definition currently in the project, without needing network access, authentication, or any deploy tooling to exist.

## Related

* [UC040 — Define an Application](UC040_DefineApplication.md) — defines the file format and folder structure this use case reads; also the source of the open questions this use case deliberately does not resolve (creation, validation, rendering, deployment).
* [UC042 — View Application Details](UC042_ViewApplicationDetails.md) — what clicking an application node opens.
* [UC029 — Navigate the Entra Tree](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md) — the overall tree this is part of.
* [UC033 — View Local Project Artifacts](../UC300_ArtifactBrowsing/UC033_ViewLocalProjectArtifacts.md) — the closest existing precedent (local, offline browsing of the project structure), diverging deliberately on file-watching (A3).
