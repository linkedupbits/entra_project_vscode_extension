# UC012 — Add Connection

## Overview

This use case details how a user registers a new connection — the saved details needed to reach one Entra tenant — so it appears under the **Connections** node of the Entra tree and can subsequently be authenticated against (see [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md)). A connection is distinct from a token: adding a connection only records where and how to sign in (and, for an app-only connection, its credential); no authentication happens as part of this use case. The user provides these details through a single webview form, not a sequence of prompts.

## Actors

* **User**
* **Extension**

## Preconditions

* A VS Code workspace is open. `<root>/connections.yaml` (root folder configurable via `entra.artifactsRootFolder`, default `entra/`) may or may not yet exist — if absent, it is created by this use case.

## Main Flow

1. User runs the `entra.addConnection` command, either from the command palette or via a "+" action on the **Connections** node of the Entra tree.
2. The extension opens a webview form (replacing any Add/Edit Connection form already open) with fields for:
   * **Name** — a short, unique, human-readable label shown as the tree node's title (e.g. "Contoso Dev").
   * **Tenant type** — Entra Workforce (default) or Entra External ID (CIAM). This determines which of the next two fields applies (see A5) and how the login authority is built (see [UC010](UC010_AuthenticateToEntra.md)).
   * **Tenant ID** — the Entra tenant ID or verified domain name to connect to.
   * **Cloud** *(Workforce only)* — a dropdown of Public (default) / US Government / China, determining the authority/Graph endpoints used. Not shown when Tenant type is External ID, since External ID has no sovereign-cloud equivalent and always stores `public`.
   * **Tenant subdomain** *(External ID only)* — the subdomain segment of the tenant's login endpoint, e.g. "contoso" for `https://contoso.ciamlogin.com/<tenant-id>/v2.0`.
   * **Application (client) ID** *(optional)* — overrides the `entra.clientId` setting for this connection only; left blank to use the default. This is the App Registration's Application (client) ID, not the Object ID of its Enterprise Application/Service Principal — the two are easy to confuse in the Entra portal and MSAL will reject the latter.
   * **Authentication method** — Delegated sign-in (default; a user signs in interactively or via device code, per UC010's main flow), Client secret, or Client certificate (the latter two authenticate the Enterprise Application itself, with no user involved — see A6/A7).
3. User fills in the form and selects **Add**. The form validates Name and Tenant ID are non-empty, that an Application (client) ID override (if provided) is shaped like a GUID, that a Tenant subdomain was entered when Tenant type is External ID, and — when Authentication method is Client secret or Client certificate — the app-only credential fields described in A6/A7, before submitting; if any check fails, submission is blocked and an inline error is shown next to the offending field without closing the form or discarding the other fields.
4. The extension appends the new connection to `<root>/connections.yaml` and writes the file.
5. The form closes and the extension refreshes the **Connections** node of the Entra tree; the new connection appears as a child node in a disconnected state, ready for [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md).

## Alternate Flows

### A1 — Name already in use

1. The entered name matches an existing connection's name — checked live as the user types, and re-checked authoritatively on submit in case the connection list changed while the form was open.
2. The form shows an inline error next to the Name field with an "Edit the existing connection instead" action. The user can either select that action (jumps to A3 below, pre-filled with the existing connection's values) or simply change the Name field and submit again; either way nothing is silently overwritten or duplicated.

### A2 — User cancels

1. The user selects **Cancel**, or closes the form's tab/panel, without having successfully submitted it.
2. The extension discards whatever was entered and makes no change to `connections.yaml`.

### A3 — Edit an existing connection

1. User runs the `entra.editConnection` command on an existing connection node instead of adding a new one — either explicitly (command palette or context menu), by clicking the connection node itself (its default click action opens this same form; see [UC029](../UC300_ArtifactBrowsing/UC029_NavigateEntraTree.md) A5), or by arriving here via A1's "edit existing" action.
2. The same form as the main flow opens, titled "Edit Connection" and pre-filled with the connection's current values (including Tenant type, Authentication method, and whichever of Cloud/Tenant subdomain/certificate thumbprint applies), and step 4 updates the existing entry in place rather than appending. A stored client secret or certificate private key is never redisplayed (see A6/A7) — those fields simply start blank, meaning "keep what's already stored."
3. If the connection is currently authenticated and its name, tenant ID, cloud, tenant type, subdomain, authentication method, or certificate thumbprint changes — or a new client secret/certificate key was entered — the extension also runs [UC011 — Disconnect](UC011_Disconnect.md) for it, since its cached session is no longer valid for the new identity/authority/credential.

### A4 — Invalid Application (client) ID format

1. The entered Application (client) ID override is non-empty but not shaped like a GUID (e.g. an app's display name was pasted instead, or the value was truncated) — checked live as the user types, and re-checked authoritatively on submit.
2. The form shows an inline error next to the field explaining it must be a GUID — the Application (client) ID, not the Enterprise Application/Service Principal's Object ID — without closing the form or discarding the other fields. This check confirms the value is *shaped* like a GUID; it cannot confirm the GUID is actually a real, existing application, which can still only be discovered when [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) is attempted.

### A5 — Entra External ID (CIAM) tenant

1. User selects "Entra External ID (CIAM)" as the Tenant type, either when adding a connection or editing one that was previously Workforce.
2. The form hides the Cloud field (forcing `public` when saved — External ID has no sovereign-cloud equivalent of `usGov`/`china`) and shows the Tenant subdomain field instead.
3. If Tenant subdomain is left blank at submit, the form shows an inline error next to it — checked live as the user types, and re-checked authoritatively on submit — without closing the form or discarding the other fields.
4. Once saved, [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) builds this connection's login authority as `https://<tenant subdomain>.ciamlogin.com/<tenant ID>/v2.0`, rather than the `login.microsoftonline.com`-family host a Workforce connection's Cloud field would select.

### A6 — Client secret (app-only)

1. User selects "Client secret" as the Authentication method, either when adding a connection or editing one that used a different method.
2. The form shows a Client secret field (masked). Adding a new connection, or switching to this method on an existing one, requires a value; editing a connection that already has a secret stored leaves the field blank by default, meaning "keep the existing secret" — submitting without typing a new value does not clear or require re-entering it.
3. If a value is required and none is entered, the form shows an inline error next to the field — checked authoritatively on submit — without closing the form or discarding the other fields.
4. On successful submit, a newly-entered secret is written to VS Code's secret storage, keyed by connection name — never to `connections.yaml`. [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) then authenticates this connection via the OAuth2 client credentials flow (no user, no browser, no device code): the Enterprise Application signs in as itself using this secret.

### A7 — Client certificate (app-only)

1. User selects "Client certificate" as the Authentication method, either when adding a connection or editing one that used a different method.
2. The form shows two fields: Certificate thumbprint (the certificate's SHA-1 or SHA-256 hash, as shown in the App Registration's "Certificates & secrets" page — non-secret, stored in `connections.yaml`) and Certificate private key (the PEM-encoded private key matching that certificate — secret, stored the same way as a client secret in A6, never in `connections.yaml`). Colons or spaces pasted into the thumbprint are stripped automatically.
3. The thumbprint is always required; the private key follows the same "blank keeps the existing one" rule as A6's secret. If the thumbprint is blank, or present but not a valid 40- or 64-character hex value, or the private key is required and missing, the form shows an inline error next to the offending field — checked live as the user types (thumbprint format) or authoritatively on submit — without closing the form or discarding the other fields.
4. On successful submit, a newly-entered private key is written to VS Code's secret storage, keyed by connection name — never to `connections.yaml`. [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) then authenticates this connection via the OAuth2 client credentials flow using the certificate, the same app-only mechanism as A6 but without a long-lived shared secret.

## Postconditions

* `<root>/connections.yaml` contains an entry for the new (or updated) connection:
  `{ name, tenantId, cloud, clientId?, tenantKind?, externalIdSubdomain?, authMethod?, certificateThumbprint? }`,
  where `clientId`, if present, is a syntactically valid GUID; `externalIdSubdomain` is present
  (and non-empty) whenever `tenantKind` is `externalId`; and `certificateThumbprint` is present
  (and a valid 40- or 64-character hex thumbprint) whenever `authMethod` is `clientCertificate`.
  This file is non-secret and safe to commit to source control — the only secrets involved (a
  client secret, or a certificate's private key) live exclusively in VS Code's secret storage
  (see A6/A7), never here.
* The connection is visible under the **Connections** node of the Entra tree, in a disconnected state, ready to be authenticated.

## Related

* [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) — the use case this enables, for all three authentication methods.
* [UC011 — Disconnect](UC011_Disconnect.md) — used by alternate flow A3 when editing a connected connection's authority; also clarifies that disconnecting an app-only connection never deletes its stored credential.
