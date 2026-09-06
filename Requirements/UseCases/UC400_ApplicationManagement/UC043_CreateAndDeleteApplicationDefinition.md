# UC043 — Create and Delete an Application Definition

## Overview

This use case covers creating a **new**, empty application definition, and **deleting** an existing
one, directly from the **Applications** node of the Entra tree (see
[UC029 — Navigate the Entra Tree](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md) and
[UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md)). It resolves the
"how does a *new* application get created from scratch?" open question [UC040](UC040_DefineApplication.md)
left deferred — for the folder/file scaffolding only. Rendering the templates and deploying the
result remain out of scope.

Like UC041, this needs no connection, no authentication, and works fully offline — it only touches
the local filesystem under `<artifactsRoot>/Applications/`.

## Actors

* **User**
* **Extension**

## Preconditions

* A VS Code workspace is open (so `<artifactsRoot>/Applications/` can be resolved — root folder
  configurable via `entra.artifactsRootFolder`, default `entra/`). Create tolerates the
  `Applications/` folder not existing yet — it is created on demand.

## Main Flow — Create

1. User invokes **New Application** — the inline `+` action on the **Applications** node, its
   context menu, or the command palette (`entra.newApplication`).
2. The extension asks for a name via an input box, validating live: non-blank, not `.` or `..`, no
   `/` or `\`, and not already the name of an existing application folder. Cancelling (Esc / focus
   away) aborts silently.
3. The extension creates `<artifactsRoot>/Applications/<name>/` and writes the four files
   [UC040](UC040_DefineApplication.md) defines, at their empty defaults, through the same
   `ApplicationStore.save()` a [UC042](UC042_ViewApplicationDetails.md) Save uses — so the new files
   have exactly the shape editing-then-saving would produce:
   * `AppConfig.yaml` — `application_name` set to `<name>`; blank `business_unit`; no `Variables`,
     `Environments`, or `Dependencies`.
   * `Application.yaml.j2` — blank display name, `AzureADMyOrg` sign-in audience, no required
     permissions or exposed scopes, plus the generated `web`/`publicClient`/`spa` redirect blocks
     (see UC040).
   * `FederatedCredentials.yaml.j2` — an empty list.
   * `ServicePrincipal.yaml.j2` — blank `appId`, `appRoleAssignmentRequired: false`, no tags, plus
     the generated `replyUrls` (see UC040).
4. The tree refreshes so the new application appears under **Applications**, and the extension
   opens it straight into [UC042](UC042_ViewApplicationDetails.md)'s structured editor so the user
   can start filling it in.

## Main Flow — Delete

1. User invokes **Delete Application** from an application node's context menu
   (`entra.deleteApplication`), or the command palette (which then asks which application via a
   quick pick).
2. The extension shows a **modal** confirmation naming the application; it proceeds only if the
   user explicitly chooses **Delete**. The dialog states that the folder goes to the trash where
   the workspace's filesystem supports it, and is deleted permanently otherwise.
3. Any open editor tab for that application — [UC042](UC042_ViewApplicationDetails.md)'s structured
   editor or [UC041](UC041_BrowseApplicationDefinitions.md)'s "Open as Document" text tab — is
   closed first, so a stale tab can't recreate the folder by being saved afterwards.
4. The extension deletes `<artifactsRoot>/Applications/<name>/` and everything under it. It tries
   the OS trash first (`useTrash: true`) so a mistaken delete stays recoverable; if the workspace's
   filesystem provider can't move to trash — dev containers and some remotes report `provider does
   not support it` — it retries as a permanent delete rather than failing.
5. The tree refreshes; a confirmation notification names what was deleted.

## Alternate Flows

### A1 — No workspace folder is open (Create)

1. `<artifactsRoot>/Applications/` can't be resolved.
2. The extension shows an error notification; nothing is created.

### A2 — Name collision or invalid name (Create)

1. The user submits a name that's blank, contains a path separator, is `.`/`..`, or matches an
   existing application folder.
2. The input box's live validation blocks submission with an inline message. If a collision is
   somehow reached anyway (e.g. a folder created externally between listing and submitting), the
   create is refused with an error notification rather than overwriting.

### A3 — Filesystem error (Create or Delete)

1. Writing the new folder, or deleting an existing one, fails (permissions, a lock, etc.).
2. The extension shows an error notification with the underlying message; the tree is left
   as-is. A partially-written new folder is not rolled back (same as [UC042](UC042_ViewApplicationDetails.md)'s Save and [UC035](../UC300_ArtifactBrowsing/UC035_DownloadApplicationArtifact.md) A3).

### A4 — Delete cancelled

1. The user dismisses the modal confirmation (Esc, or the dialog's close/cancel).
2. Nothing is deleted, no tabs are closed, no notification is shown.

## Postconditions

* **Create**: `<artifactsRoot>/Applications/<name>/` exists and satisfies [UC040](UC040_DefineApplication.md)'s
  format with every field at its empty default except `application_name`; UC042's editor opens on it.
* **Delete**: `<artifactsRoot>/Applications/<name>/` no longer exists (in the trash where supported,
  otherwise permanently); no editor tab for it remains open; the **Applications** tree no longer
  lists it.
* Neither operation touches any connection, any other application, or anything outside that one
  folder.

## Related

* [UC040 — Define an Application](UC040_DefineApplication.md) — the file format the created folder
  satisfies; the open question this use case resolves (folder scaffolding only).
* [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md) — the tree these
  actions are invoked from; its A1 placeholder is what a freshly-created-then-deleted project shows.
* [UC042 — View Application Details](UC042_ViewApplicationDetails.md) — opened right after Create;
  its tab (and UC041's "Open as Document" tab) is what Delete closes first.
