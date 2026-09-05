# UC033 — View Local Project Artifacts

## Overview

This use case details how a user browses the Entra artifacts already present in the local project structure, independent of any tenant connection — the "infrastructure as code" view of the workspace. Viewing an artifact here uses the same shared artifact-viewer webview as [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md), so a local artifact and a remote (pre-download) one look and behave identically when viewed.

## Actors

* **User**
* **Extension**

## Preconditions

* A VS Code workspace is open. An artifacts root folder (`entra/` by default) may or may not yet exist — an empty/missing folder is a valid, empty state, not an error.

## Main Flow

1. User expands the **Project** node of the Entra tree (see [UC029 — Navigate the Entra Tree](UC029_NavigateEntraTree.md)).
2. The extension scans the artifacts root folder and renders one category node per sub-folder present (App Registrations, Service Principals, Groups, Directory Roles, External ID User Flows, External ID Custom Authentication Extensions), each containing one artifact-detail item per `.yaml` file found, labelled by the file's `displayName`/`id` (parsed from the filename, not by parsing the full YAML, so the tree stays fast for large projects).
3. User selects an item (or runs `entra.viewArtifact`) to open it read-only in the shared artifact-viewer webview, titled with the artifact's display name and badged "Local file: `<path>`".
4. To hand-annotate the file with comments or otherwise edit it, the user runs `entra.editArtifactFile` from the same context menu, which opens the raw `.yaml` file in a normal text editor — the viewer itself never accepts edits.
5. This view requires no authentication and works fully offline.

## Alternate Flows

### A1 — File added, removed, or edited externally

1. A file under the artifacts root is created, deleted, or renamed outside the extension (e.g. via git operations, another editor, or manual copy).
2. The extension's `FileSystemWatcher` on the artifacts root detects the change and refreshes the affected part of the tree automatically, without requiring a manual refresh.

### A2 — Malformed YAML file

1. A file in the artifacts root fails to parse as YAML, or is missing required fields (e.g. `_meta`, `id`).
2. The extension still lists the file (using the filename alone) but marks it with a warning icon/tooltip rather than failing to render the whole category.

### A3 — Compare with tenant

1. User selects a local artifact and runs a "Compare with tenant" action while connected to the connection recorded in the file's `_meta.sourceConnection`.
2. This composes with [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)'s diff behaviour (A1), re-fetching the current remote state and diffing it against the local file.

## Postconditions

* The user can see and open every artifact currently represented in the project structure without needing network access or an authenticated session.

## Related

* [UC029 — Navigate the Entra Tree](UC029_NavigateEntraTree.md) — the overall tree this is one branch of.
* [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md) — produces the files this view reads.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — how new files are added to this view.
