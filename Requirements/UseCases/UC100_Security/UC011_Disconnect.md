# UC011 — Disconnect

## Overview

This use case details how a user disconnects the extension from a previously authenticated connection, clearing its cached session (token, and for a delegated connection, its signed-in account). For an app-only connection (client secret or certificate, see [UC012](UC012_AddConnection.md) A6/A7) this ends the session only — it never deletes the stored credential itself, since that's a long-lived identity, not a session; see A2.

## Actors

* **User**
* **Extension**

## Preconditions

* A valid or expired MSAL token cache exists in VS Code secret storage for the target connection (i.e. the user has previously completed [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md), delegated or app-only).

## Main Flow

1. User runs the `entra.disconnect` command, either from the command palette or from the connection's context menu under the **Connections** node of the Entra tree.
2. The extension removes the MSAL token cache entry for that connection from VS Code secret storage.
3. The extension clears any in-memory client/account state held for that connection (the `PublicClientApplication` and its signed-in account for a delegated connection; the "connected" flag for an app-only one — see A2).
4. The connection's tree node collapses and is marked as disconnected; its signed-in account (delegated) is removed from the status bar.

## Alternate Flows

### A1 — Disconnect all

1. User runs `entra.disconnect` with no connection pre-selected, or a "Disconnect all" command variant.
2. The extension repeats the main flow for every connection that currently has a cached token, delegated and app-only alike.

### A2 — Disconnecting an app-only connection preserves its credential

1. The connection being disconnected uses Authentication method "Client secret" or "Client certificate" (see [UC012](UC012_AddConnection.md) A6/A7).
2. Steps 1–4 of the main flow apply exactly as written — but since there is no user account for an app-only connection, only its cached app-only token and "connected" state are cleared. Its client secret or certificate private key, held in its own separate secret storage entry, is left untouched. Reconnecting (UC010 A5) reuses it without prompting the user to re-enter it — only removing the connection entirely, or editing it to clear/replace the credential (UC012 A6/A7), changes that.

## Postconditions

* No token remains cached for the disconnected connection(s).
* Browsing that connection's artifacts again requires repeating [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) — for an app-only connection, this happens without re-prompting for its credential (see A2).
* The connection itself (its saved details, and for an app-only connection, its stored credential) is unaffected — disconnecting clears the session, not the saved connection or its credential; removing the connection entirely, or replacing its credential, are separate actions (see [UC012](UC012_AddConnection.md)). Any artifacts already downloaded to the local project structure are also unaffected — disconnecting never touches local files.

## Related

* [UC010 — Authenticate to Entra](UC010_AuthenticateToEntra.md) — the use case this reverses.
* [UC012 — Add Connection](UC012_AddConnection.md) — how the connection being disconnected was created.
