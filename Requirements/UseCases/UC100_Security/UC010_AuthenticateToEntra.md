# UC010 — Authenticate to Entra

## Overview

This use case details the process for a user of the extension to authenticate to Entra via a previously saved connection, so it can be browsed. Most connections are **delegated** — a user signs in interactively or via device code, per the main flow below — but a connection can instead be configured for **app-only** authentication (see [UC012](UC012_AddConnection.md) A6/A7), where the Enterprise Application signs in as itself via a client secret or certificate, with no user and no browser involved (see A5).

## Actors

* **User** — a developer/administrator using the extension (delegated connections only — see A5 for app-only).
* **Extension** — the VS Code extension.
* **Microsoft Entra ID / Microsoft Graph** — the identity provider and API being authenticated to.

## Preconditions

* The user has at least one connection saved (see [UC012 — Add Connection](UC012_AddConnection.md)), listed under the **Connections** node of the Entra tree.
* The user is not currently holding a valid, cached token for the selected connection.
* For an app-only connection (A5), its client secret or certificate private key is already stored (set when the connection was added/edited — see [UC012](UC012_AddConnection.md) A6/A7).

## Main Flow (delegated — interactive browser login)

1. User selects a connection under the **Connections** node of the Entra tree (or runs the `entra.connect` command) that has no valid cached session.
2. The extension resolves the connection's authority and client ID (the connection's own override, or the `entra.clientId` setting default). For a Workforce connection this is `https://<cloud's login host>/<tenant ID>`; for an Entra External ID (CIAM) connection (see [UC012](UC012_AddConnection.md) A5) it is instead `https://<tenant subdomain>.ciamlogin.com/<tenant ID>/v2.0`, ignoring the (hidden, always-`public`) Cloud field.
3. The extension starts a loopback listener on localhost and opens the user's default browser via `vscode.env.openExternal`, directing them to the Microsoft identity platform sign-in page for that tenant.
4. The user completes sign-in and any required consent in the browser.
5. The browser redirects back to the loopback listener with an authorization code; the extension exchanges it for tokens.
6. The extension persists the resulting MSAL token cache to VS Code's secret storage, scoped to that connection (see `NonFunctionalRequirements.md`).
7. The connection's tree node is marked as connected and expands to show its artifact-type folders; the status bar reflects the signed-in account.

## Alternate Flows

### A1 — Device code fallback

Used when a local loopback browser flow is not viable (e.g. remote SSH/Codespaces session), controlled by the `entra.authMode` setting.

1. Steps 1–2 as above.
2. The extension requests a device code from Microsoft Entra ID and displays the user code and verification URL to the user (via a VS Code notification/quick pick).
3. The user opens the verification URL on any device, enters the code, and signs in.
4. The extension polls for token issuance, then continues from step 6 of the main flow.

### A2 — Silent re-authentication

1. User selects a connection for which a valid, non-expired cached token already exists.
2. The extension acquires a token silently from the cached refresh token without prompting the user.
3. Flow proceeds as connected without any browser/device-code interaction.

### A3 — Consent required / conditional access challenge

1. During step 4/5 of the main flow, Entra ID returns an error requiring additional consent or an MFA/Conditional Access challenge.
2. The browser presents the required challenge to the user inline; once satisfied, the flow resumes at step 5.

### A4 — Sign-in fails or is cancelled

1. The user closes the browser tab, denies consent, or sign-in otherwise fails.
2. The extension surfaces an error notification and leaves the connection in a disconnected state. No partial token is cached.

### A5 — App-only authentication (client secret or certificate)

Used for a connection configured with Authentication method "Client secret" or "Client certificate" (see [UC012](UC012_AddConnection.md) A6/A7) instead of the default "Delegated sign-in". No user interaction happens at all — no browser, no device code.

1. User selects the connection (or runs `entra.connect`) that has no valid cached app-only session.
2. The extension resolves the connection's authority (as in step 2 of the main flow) and retrieves the connection's stored credential (client secret, or certificate private key) from VS Code's secret storage. If none is stored — e.g. the connection was switched to an app-only method but no credential was ever saved for it — the extension surfaces an error directing the user to edit the connection and provide one, and stops here.
3. The extension requests a token directly from Microsoft Entra ID using the OAuth2 client credentials grant, authenticating as the Enterprise Application itself with the retrieved credential — no authorization code, no refresh token, no signed-in user or account.
4. The extension persists the resulting MSAL token cache to VS Code's secret storage, scoped to that connection, the same as the delegated flow (see `NonFunctionalRequirements.md`). The credential itself remains in its own separate secret storage entry (see [UC012](UC012_AddConnection.md) A6/A7) — it is not part of this cache and is unaffected by [UC011 — Disconnect](UC011_Disconnect.md).
5. The connection's tree node is marked as connected and expands to show its artifact-type folders; the status bar reflects it, though — unlike the delegated flow — there is no signed-in user account to display.

## Postconditions

* On success (delegated or app-only), a valid token for the connection's required Graph scopes is cached in VS Code secret storage, and the connection's node can enumerate artifacts (see UC030, related below).
* On failure, no token is cached and the connection remains disconnected.

## Related

* [UC012 — Add Connection](UC012_AddConnection.md) — precondition; how a connection (and, for app-only, its credential) comes to exist.
* [UC011 — Disconnect](UC011_Disconnect.md) — reverses this use case; for app-only, ends the session without deleting the stored credential.
* [UC030 — Browse Tenant Artifacts](../UC300_ArtifactBrowsing/UC030_BrowseTenantArtifacts.md) — the primary use case this authentication enables.
