# UC030 — Browse Tenant Artifacts

## Overview

This use case details how a user browses the Entra artifacts deployed in a tenant, via Microsoft Graph, by expanding a connection under the **Connections** node of the Entra tree.

## Actors

* **User**
* **Extension**
* **Microsoft Graph**

## Preconditions

* The connection being browsed has been authenticated (see [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md)), or authentication is triggered on demand as part of this flow.

## Main Flow

1. User expands a connection node under **Connections** in the Entra tree.
2. If no valid cached token exists for the connection, [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) runs first.
3. The extension shows the fixed set of artifact-category folder nodes under the connection: App Registrations, Service Principals, Groups, Directory Roles, External ID User Flows, External ID Custom Authentication Extensions.
4. User expands a category folder node.
5. The extension calls the corresponding Microsoft Graph endpoint (e.g. `GET /v1.0/applications`) using the connection's cached token, and renders one artifact-detail tree item per returned object, labelled by display name.
6. User can select an artifact-detail item to view its key properties, or proceed to [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md) / [UC031 — Download Artifact](UC031_DownloadArtifact.md).

## Alternate Flows

### A1 — Paged results

1. The Graph response includes an `@odata.nextLink`.
2. The extension appends a "Load more…" tree item at the end of the currently-loaded list; selecting it fetches and appends the next page.

### A2 — Throttling (429)

1. Microsoft Graph returns a `429 Too Many Requests` with a `Retry-After` header during listing.
2. The extension waits the indicated duration and retries automatically (bounded number of retries), showing a transient "retrying…" state on the node rather than failing immediately.

### A3 — Insufficient permissions

1. Microsoft Graph returns a `403 Forbidden` for a category (e.g. the signed-in account lacks the Graph permission for External ID custom authentication extensions).
2. The extension shows that category node in an error state with a tooltip explaining the missing permission, while other categories continue to function normally.

### A4 — Refresh

1. User runs a refresh command on a connection or category node.
2. The extension discards cached listing state for that node and re-fetches from Graph, reflecting any changes made in the tenant since the last browse.

## Postconditions

* The connection's branch of the Entra tree reflects the current state of the tenant's artifacts for the categories in scope, ready for preview or download.
* No local files are created or modified by browsing alone.

## Related

* [UC029 — Navigate the Entra Tree](UC029_NavigateEntraTree.md) — the overall tree this is one branch of.
* [UC010 — Authenticate to Entra](../UC100_Security/UC010_AuthenticateToEntra.md) — precondition.
* [UC031 — Download Artifact](UC031_DownloadArtifact.md)
* [UC032 — Preview Artifact Before Download](UC032_PreviewArtifactBeforeDownload.md)
