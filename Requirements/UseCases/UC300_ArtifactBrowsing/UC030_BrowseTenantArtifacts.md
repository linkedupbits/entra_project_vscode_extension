# UC030 — Browse Tenant Artifacts

## Overview

This use case details how a user browses the Entra artifacts deployed in a tenant, via Microsoft Graph, by expanding a connection under the **Connections** node of the Entra tree.

**Implementation status:** only the **Applications** category (App Registrations) is implemented,
for a connection that is already connected, with several simplifications from the full flow
described below — see each step and alternate flow for what's actually built versus still
aspirational. Applications under a connection are grouped by logical environment (A5). The other
five categories, auto-triggering sign-in on expand, manual "Load more" paging, throttling retry,
and per-category permission errors are not yet implemented.

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The connection being browsed has been authenticated (see [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md)), or authentication is triggered on demand as part of this flow.

## Main Flow

1. User expands a connection node under **Connections** in the Entra tree.
2. If no valid cached token exists for the connection, [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) runs first. **Not implemented**: today, a disconnected connection is a leaf with no expand affordance at all — this step only applies once the user has already run `entra.connect` on it explicitly. A connected connection instead shows a single **Applications** folder node.
3. The extension shows the fixed set of artifact-category folder nodes under the connection: App Registrations, Service Principals, Groups, Directory Roles, External ID User Flows, External ID Custom Authentication Extensions. **Implemented so far**: only **Applications** (this use case's name for Graph's App Registrations, matching [UC040](../UC400_ApplicationManagement/UC040_DefineApplication.md)/[UC041](../UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md)'s naming for the equivalent local concept). The other five remain unimplemented.
4. User expands the Applications folder node.
5. The extension calls `GET /v1.0/applications` (`$select=id,appId,displayName`) using an access token for the connection (delegated: acquired silently from the cached account; app-only: via the client-credentials grant — see `AuthService.getGraphAccessToken()`), and renders one tree item per returned application, labelled by display name (falling back to the application ID if display name is blank), with the application ID shown as the item's description and both IDs in its tooltip. **Implemented with environment grouping**: the extension also calls `GET /v1.0/servicePrincipals` (`$select=id,appId,displayName,tags`, `@odata.nextLink` followed automatically — see `graphClient.ts`'s `listServicePrincipals()`) and groups the applications by the `Environment:<name>` tag on the matching Service Principal (matched by `appId`) — see A5.
6. User can select an artifact-detail item to preview it (see [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md), the implemented instance of [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)) or, in a later phase, proceed to [UC031 — Download Artifact](UC031_DownloadArtifact.md).

## Alternate Flows

### A1 — Paged results

1. The Graph response includes an `@odata.nextLink`.
2. **Implemented differently than originally specified**: rather than a manual "Load more…" tree item, the extension follows every `@odata.nextLink` automatically and returns the complete set of applications in one call (see `graphClient.ts`'s `listApplications()`) — simpler to implement correctly, at the cost of one slower initial expand for a very large tenant instead of incremental loading. Revisit if that trade-off proves wrong in practice.

### A2 — Throttling (429)

1. Microsoft Graph returns a `429 Too Many Requests` with a `Retry-After` header during listing.
2. **Not implemented.** A 429 is currently treated the same as any other failed request — see A3 below.

### A3 — Insufficient permissions

1. Microsoft Graph returns a `403 Forbidden` for a category (e.g. the signed-in account lacks the Graph permission for Application.Read.All).
2. **Implemented as a general case, not 403-specific**: any failure acquiring a token or calling Graph while expanding the Applications folder (403 included) is caught and shown as a single error tree item under it (`Could not load applications`, with the underlying error message as its description/tooltip) rather than a 403-specific error state or leaving the node stuck loading. Since only one category is implemented, "other categories continue to function normally" doesn't yet apply.

### A5 — Grouping applications by environment

1. The extension lists the tenant's Service Principals (`GET /v1.0/servicePrincipals`, `$select=id,appId,displayName,tags`) alongside the applications, and builds a map of `appId` → `tags`.
2. For each application, it reads the value of the first `Environment:<name>` tag on the matching Service Principal (see `tenantApplicationIdentity.ts`'s `environmentTagValue()` — a blank/whitespace-only value counts as "no environment"; an unresolved `{{Environment}}` placeholder value is kept as a real group name).
3. Applications sharing an environment value are collected under one **Environment: &lt;name&gt;** grouping node (`TenantApplicationEnvironmentGroupItem`, collapsed, showing an application count as its description). Grouping nodes are listed first, sorted by environment name; applications with no environment tag (or no Service Principal) follow as ungrouped detail items. Applications within a group, and the ungrouped list, are each sorted by display name.
4. Expanding a grouping node lists its applications as ordinary `TenantApplicationItem`s — clicking one previews it exactly as an ungrouped item would (step 6 / UC034).
5. **Degradation**: if the `servicePrincipals` call fails (e.g. the connection lacks `ServicePrincipal.Read.All`), the extension falls back to a flat, ungrouped application list rather than showing the whole Applications node as an error (A3) — the applications themselves loaded successfully. A failure listing the *applications* still surfaces as A3's error item.

### A4 — Refresh

1. User runs a refresh command on a connection or category node.
2. **Implemented at the whole-tree level, not node-scoped**: the existing `entra.refreshConnections` command (the Connections view's refresh icon) re-renders the entire Entra tree, which re-runs this use case's Graph call for any Applications folder currently expanded — there's no per-connection or per-category refresh command yet.

## Postconditions

* The connection's branch of the Entra tree reflects the current state of the tenant's applications, once the Applications folder has been expanded, grouped by the logical environment each application's Service Principal is tagged with (A5).
* No local files are created or modified by browsing alone.

## Related

* [UC029 — Navigate the Entra Tree](UC029_NavigateEntraTree.md) — the overall tree this is one branch of.
* [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) — precondition.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md)
* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)
* [UC034 — Preview an Application Artifact](UC034_PreviewApplicationArtifact.md) — the implemented preview flow reached from step 6.
