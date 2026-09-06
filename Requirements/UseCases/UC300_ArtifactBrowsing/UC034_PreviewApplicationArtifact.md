# UC034 — Preview an Application Artifact

## Overview

This use case is the currently-implemented instance of [UC032 — Preview Artifact Before
Download](UC032_PreviewArtifactBeforeDownload.md), scoped to the one artifact category UC030
implements today: **Applications** (App Registrations) under a connected connection. UC032 stays
the generic specification for previewing *any* artifact category, including behavior (the `_meta`
block, "Compare with local file") this use case doesn't implement yet; this document describes
only what actually happens for an application, and exists separately so UC032 isn't rewritten to
describe one category's specifics while still standing for the general case.

The preview is **structured**, not a raw data dump: it shows the same three sections —
Application (App Registration), Federated Credentials, Service Principal — that
[UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md)
shows for a *local* application definition, using the exact same field normalization
(`applications/types.ts`), so a tenant application and a local one look and are organized
identically. Unlike UC042, this view has no inputs, no add/remove controls, and no Save action —
it is read-only by construction (UC032's requirement), and unlike a local application definition,
a live tenant application has no `AppConfig.yaml` equivalent (no business unit, variables,
environments, or dependencies to show).

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The user has expanded a connected connection's **Applications** folder (see [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md)), so at least one application item is visible.

## Main Flow

1. User selects an application item under a connection's **Applications** folder.
2. The extension makes three Microsoft Graph calls, showing a progress notification while they're
   in flight:
   * `GET /v1.0/applications/{id}` — the application's full representation (every field, not just
     the `id`/`appId`/`displayName` subset UC030's listing call selects). Graph's own
     `@odata.context` response metadata is stripped, since it describes the response shape rather
     than the application itself.
   * `GET /v1.0/applications/{id}/federatedIdentityCredentials` — the application's federated
     identity credentials, if any (paged the same way UC030's application listing is, though a
     typical application has very few).
   * `GET /v1.0/servicePrincipals?$filter=appId eq '{appId}'` — the Enterprise Application
     (Service Principal) for this application's `appId`, if one exists.
   * Once the application's `requiredResourceAccess` is known, one further
     `GET /v1.0/servicePrincipals?$filter=appId eq '{resourceAppId}'&$select=displayName,tags,appRoles,oauth2PermissionScopes`
     call per *distinct* resource application it references (not per permission row, and not for
     Microsoft Graph — see step 4's Required Permissions bullet below) — resolving each referenced
     resource's display name, its Service Principal's `tags` (used by UC035 A6 to name the
     dependency's project folder), and its own permission catalogue.
3. Each of the three application/credentials/service-principal responses is normalized through the same functions
   [UC042](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md)'s structured editor
   uses to read `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and
   `ServicePrincipal.yaml.j2` from disk — so identical field mapping (and the same unmodelled-field
   limitations) applies to both a tenant application and a local one. The application's redirect
   URIs are the one exception: UC042 models those per environment, not on the App Registration, so
   the preview reads the tenant application's `web.redirectUris` / `publicClient.redirectUris` /
   `spa.redirectUris` straight off the raw Graph fetch and shows all three as separate lists.
4. The extension shows a **Unique name** line, then the three normalized sections —
   **Application (App Registration)**, **Federated Credentials**, **Service Principal** — in a
   read-only webview panel (`ArtifactViewerPanel`), titled with the application's display name (or
   its application ID if display name is blank) and badged "Connection: `<connection name>`". Each
   section shows its fields as plain read-only text/lists (not inputs), including an explicit
   "None" for an empty list (each of the three redirect-URI categories, no required permissions, no
   federated credentials, no tags) — never a silently blank section indistinguishable from one that
   failed to load.
   * **Unique name** is the `AppName:<Environment>_<BusinessUnit>_<AppName>` tag on the Service
     Principal (see UC042's Generated tags preview), shown as `<Environment>_<BusinessUnit>_<AppName>`
     — the one identifier guaranteed unique across applications that happen to share a Graph
     `displayName`, which Graph itself doesn't enforce as unique. Shown as an explicit "No unique
     name tag found" state, not omitted, when the Service Principal has no such tag or its section
     failed to load (see `tenantApplicationIdentity.ts`'s `parseTenantApplicationIdentity()`).
   * Each required-permission row shows `<Application name> : <Scope name> (<Application ID> : <Scope ID>)`
     — e.g. `Microsoft Graph : Directory.Read.All (00000003-0000-0000-c000-000000000000 :
     7ab1d382-f21e-4acd-a863-ba3e13f7da61)`. The two IDs are always shown, never replaced by the
     resolved names, so the underlying value stays visible/verifiable; whichever name (or both)
     couldn't be resolved falls back to showing that half's raw ID in its place instead of blocking
     the row. Names are resolved two ways:
     * `resourceAppId` equal to Microsoft Graph's well-known ID
       (`00000003-0000-0000-c000-000000000000`) resolves from a checked-in, regeneratable lookup
       table holding Microsoft Graph's complete permission catalogue (see
       `scripts/downloadGraphPermissions.js`, which by default fetches this from Microsoft's own
       public, unauthenticated permissions reference data — no credentials needed, with a
       `--from-tenant` fallback that queries a live tenant instead) — no network call at preview
       time.
     * Any other `resourceAppId` resolves from the live lookup step 2 makes for it — the
       resource's own display name, and its own `id`→name mapping from its `appRoles`/
       `oauth2PermissionScopes` — obtained at runtime, not from any checked-in data, since this
       extension has no static catalogue for resources other than Microsoft Graph. A resource
       whose lookup failed, found no Service Principal, or doesn't expose the referenced
       permission ID simply falls back to raw IDs for the affected half(s) of that row.

     This resolution is preview-only; UC042's local, editable Required Permissions list does not
     (yet) do the same.
   * A **Dependencies** list (under the Application section) shows the other applications this one
     depends on, worked out from its Required Permissions: every distinct `resourceAppId` that
     **isn't** Microsoft Graph's well-known ID is a dependency, shown as `<resolved name>
     (<resourceAppId>)`, or as the raw ID flagged "unresolved" when no Service Principal for it
     exists in this tenant. Microsoft Graph is never listed (it isn't "another application" — see
     `deriveApplicationDependencies()`). This is the same derivation UC035's download writes into
     `AppConfig.yaml`'s `Dependencies` map. "None" when every required permission is Microsoft
     Graph (or there are none).
   * The panel always shows a **Download to project** button — see
     [UC035 — Download an Application Artifact to the Project](UC035_DownloadApplicationArtifact.md).
     When no unique name was found, selecting it prompts for an application name instead of
     downloading immediately (UC035 A4) rather than the button being omitted or disabled.
5. The user reads the content. Aside from that one Download button, the panel has no editable
   fields and no other path back to the tenant or to a local file — it is a viewer only.
6. Selecting the same application again while its panel is still open brings that existing panel
   forward (and refreshes its content with fresh Graph fetches) rather than opening a duplicate,
   keyed by connection name + object ID.

## Alternate Flows

### A1 — One of the three Graph calls fails

1. Any one of the three calls in step 2 fails independently — including the application fetch
   itself, not only the federated-credentials or service-principal lookups (e.g. the connection's
   token lacks the Graph permission for service principals specifically, while application and
   federated-credential permissions are fine; or a transient failure hits just one of the three
   calls).
2. That call's section renders its own inline error message in place of its fields; the other two
   sections still render normally from their independently-successful calls — a partial failure
   narrows what's shown, it doesn't block the other two sections. All three calls run
   independently precisely so this can happen (see `loadApplicationPreview`'s use of
   `Promise.allSettled`).

### A2 — Acquiring a Graph access token fails

1. The connection's access token can't be acquired at all (e.g. the connection was disconnected
   between listing and selecting the application) — this happens once, before any of the three
   Graph calls in step 2 are attempted, since all three need the same token.
2. The extension shows an error notification naming the application and the underlying message; no
   preview panel is opened (or, if one was already open for a different application, it is left
   untouched). Unlike A1, this is "nothing to show at all" rather than a partial failure, since no
   call was even attempted.

### A3 — A resource application's permission lookup fails or finds nothing

1. One of step 2's per-resource lookups fails (e.g. no permission to read that resource's Service
   Principal), or succeeds but finds no Service Principal for that `resourceAppId` in this tenant.
2. Unlike A1, this doesn't produce a section-level error: the Required Permissions list still
   renders normally, with that resource's rows falling back to raw IDs in place of the names that
   lookup would have provided (see step 4's Required Permissions bullet). A failure resolving one
   resource has no effect on any other resource's rows, including Microsoft Graph's (never looked
   up live at all — see step 4).

## Postconditions

* No file is created or modified in the local project structure as a result of previewing alone.
* The user has enough information to decide whether the application is the one they were looking
  for — deciding to download it, or comparing it with a local file, are both out of scope (see
  Related).

## Not implemented (deferred to UC032/UC031/UC033 once those exist)

* The `_meta` block (source connection, tenant ID, Graph endpoint/API version, fetch timestamp)
  UC020/UC032 describe.
* Any field the structured sections don't model — the same accepted limitation
  [UC042](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md) documents for the local
  editor (e.g. `identifierUris`, `appRoles`, `web.implicitGrantSettings` on the Application; any
  Service Principal field beyond `appId`/`appRoleAssignmentRequired`/`tags`) is the same limitation
  here — a deliberate parity choice with UC042 rather than an oversight, not a raw-data fallback.
* "Compare with local file" (UC032 A1) — there's no downloaded-artifact concept yet to compare
  against.
* Previewing any category other than Applications — the other five UC030 lists remain
  unimplemented, so there's nothing else to preview yet.

A "Download" action from the panel *is* implemented — see
[UC035](UC035_DownloadApplicationArtifact.md) — always available, prompting for an application
name when no unique-name tag is present (UC035 A4) rather than requiring one. UC031's generic (and
structurally different) flat-snapshot download remains unimplemented for every category,
Applications included.

## Related

* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md) — the generic use case this implements one instance of.
* [UC030 — Browse Tenant Artifacts](UC030_BrowseTenantArtifacts.md) — how the user reaches the previewed item.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md) — the deferred next step.
* [UC033 — View Local Project Artifacts](UC033_ViewLocalProjectArtifacts.md) — the deferred local-file side of the shared viewer.
* [UC042 — View Application Details](../UC400_ApplicationManagement/UC042_ViewApplicationDetails.md) — the local, editable counterpart whose field layout and normalization logic this preview reuses.
* [UC035 — Download an Application Artifact to the Project](UC035_DownloadApplicationArtifact.md) — the Download button this preview's panel always offers.
