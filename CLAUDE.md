# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A VS Code extension (see Status below for how far along it is) that lets a developer/administrator:

1. **View Entra artifacts as a local project structure** — a version-controllable, YAML-based
   representation of Entra objects (the "infrastructure as code" angle).
2. **Connect to a Microsoft Entra tenant via Microsoft Graph**, interactively authenticate, browse
   deployed artifacts, and download them into that local project structure.

v1 is **read-only**: browse and download only, no write-back/deploy of local files to a tenant yet.
v1 artifact scope: **app registrations & service principals**, **groups & directory roles**, and
**Entra External ID (CIAM) user flows & custom authentication extensions**. Conditional Access
policies are explicitly out of scope (high risk of tenant lockout from an incorrect change).

## Status

As of 2026-09-05, the extension is scaffolded and under active development: TypeScript source
under `src/` (bundled via esbuild), a Vitest suite with enforced coverage thresholds in
`vitest.config.mts` (see `NonFunctionalRequirements.md`'s coverage requirement), and a
`.devcontainer/` setup. Check the actual tree rather than trusting this paragraph's specifics as
they age — this file records *decisions and rationale*, not a live file listing.

Development happens inside the committed Dev Container (`.devcontainer/devcontainer.json` +
`setup.sh`). Two things worth understanding before touching it:

- **Claude Code state is bind-mounted from the host, not copied.** `~/.claude` and
  `~/.claude.json` are bind mounts of the host's real files, and the workspace itself is forced
  to mount at the same absolute path inside the container as on the host (`workspaceMount`/
  `workspaceFolder` in devcontainer.json) rather than the default `/workspaces/<folder>`. Both
  matter together: Claude Code keys per-project session/memory storage off the absolute
  workspace path, so if only `~/.claude` were shared but the path differed, the container would
  still see this as a different, history-less project. A Docker *named volume* was tried first
  and rejected — it starts empty, so it only stops future rebuilds losing data; it does nothing
  for a session that already exists on the host (a real gap, not a hypothetical one — it's why
  this was reworked). Don't reintroduce a named volume for `~/.claude` without solving that.
- The host's `~/.ssh` is bind-mounted read-only then copied into a writable,
  correctly-permissioned `~/.ssh` inside the container by `setup.sh` (a straight bind mount
  can't be `chmod`'d, and ssh refuses keys that are group/world-readable). Don't hand-edit
  permissions on `~/.ssh` inside the container as a one-off fix — fix `setup.sh` instead, or the
  fix is lost on the next rebuild.

Node.js is pinned via the base image itself —
`mcr.microsoft.com/devcontainers/typescript-node:24-bookworm` (Node 24 "Krypton") — rather than a
generic base image plus a separate Node feature; that image's non-root user is `node`, not the
`vscode` user other devcontainer base images use, and `devcontainer.json`'s `remoteUser` and mount
paths (`/home/node/...`) depend on that being correct if the base image ever changes. The tag pins
the Node *major* version and Debian variant deliberately, not an exact patch (see
`NonFunctionalRequirements.md` — only major-level tags get Microsoft's ongoing OS security
patches). This needs a manual bump when a newer LTS is promoted; don't assume the pinned major is
still current without checking https://nodejs.org/en/about/previous-releases — this file's date
can be well after this assistant's knowledge cutoff.

## Source of truth

`Requirements/` is the source of truth for scope and behavior, and should stay in sync with the
code as it's built:

- `FunctionalRequirements.md` — what the extension does, in prose.
- `NonFunctionalRequirements.md` — cross-cutting constraints (currently: secrets must go through
  VS Code's `SecretStorage`; downloaded artifacts must serialize as YAML, not JSON, so users can
  hand-annotate them with comments).
- `UseCases/UC100_Security/` — connections and authentication (UC010 login, UC011 disconnect, UC012
  add connection).
- `UseCases/UC200_ArtifactSerialisation/` — how a Graph object becomes a local file (UC020).
- `UseCases/UC300_ArtifactBrowsing/` — the tree control itself (UC029), and
  browsing/downloading/previewing tenant artifacts and viewing the local project structure
  (UC030–UC033).

**Requirements are kept in sync with the implementation — this is a hard rule, not a nice-to-have.**
Any change to behavior, the data model, validation, or the UI is done *together with* updating the
relevant `Requirements/` doc(s) (the affected UseCase's main/alternate flows and postconditions,
`FunctionalRequirements.md`, `NonFunctionalRequirements.md`, and this file's own decisions/status)
in the same piece of work — never deferred to "later" or left for someone else to notice drifted.
If a change doesn't obviously map to an existing UseCase, that's a signal to add one, not to skip
documenting it. These docs are meant to be read, not just written once.

## Key architecture decisions already made

These came out of an explicit planning pass with the user and should not be silently re-litigated:

- **Auth**: `@azure/msal-node`, not VS Code's built-in Microsoft authentication provider — the
  built-in provider's scope/consent surface doesn't reliably cover Graph app-management and CIAM
  scopes across arbitrary tenants, nor app-only auth at all. Two families of flow, per connection
  (see `authService.ts`):
  - **Delegated** (default) — `PublicClientApplication`. Primary flow is interactive (loopback
    redirect + system browser); device code is the explicit fallback for remote/SSH/Codespaces
    sessions, selected via an `entra.authMode` setting.
  - **App-only** (`authMethod: 'clientSecret' | 'clientCertificate'`, see UC012 A6/A7) —
    `ConfidentialClientApplication` using the OAuth2 client credentials grant
    (`acquireTokenByClientCredential`); no user, no browser, no account. `isConnected()` tracks
    these connections in a separate `Set<string>` (`appOnlyConnected`) rather than the delegated
    path's `Map<string, AccountInfo>`, since there's no account to key on.
- **Token storage**: MSAL's token cache is persisted through a custom `ICachePlugin` backed by
  `vscode.SecretStorage`, one cache blob per saved connection — used for both flow families.
  Tokens are never written to a project file.
- **App-only credential storage**: a client secret or certificate private key is a long-lived
  credential, not a session — a different kind of thing from the token cache above, and
  `auth/credentialStore.ts`'s `CredentialStore` keeps it in its own `vscode.SecretStorage` entries
  (`entra.clientSecret.<name>` / `entra.clientCertificateKey.<name>`), never in
  `connections.yaml`. Because it's an identity, not a session, UC011 disconnect never deletes it
  (only editing/removing the connection can); a connection rename moves it
  via `CredentialStore.renameConnection()` rather than losing it. MSAL's own
  `clientCertificate.thumbprint` field is deprecated in favor of `thumbprintSha256` — `authService.ts`'s
  `buildClientCertificateConfig()` picks whichever field matches the length of what the user
  provided (40 hex chars = SHA-1 `thumbprint`, 64 = `thumbprintSha256`) rather than forcing one
  format, since Entra's portal has long shown SHA-1.
- **Connections model**: a **connection** (`{ name, tenantId, cloud, clientId?, tenantKind?,
  externalIdSubdomain?, authMethod?, certificateThumbprint? }`) is the saved, non-secret record of
  how to reach one tenant — distinct from the token (and, for app-only, the credential) that
  authenticating against it produces/uses. Connections are created/edited only through the
  Add/Edit Connection webview (UC012), never by hand-editing `<artifacts-root>/connections.yaml`
  directly, even though that file is itself non-secret and safe to commit. It's YAML (not JSON,
  unlike its earlier form) for the same reason downloaded artifacts are — so a hand-maintained
  project can annotate a connection with comments (see `NonFunctionalRequirements.md`). This is
  the v1 building block the functional requirement's later "deploy the same artifacts to multiple
  logical environments" goal will build on (an environment will likely map to one or more named
  connections).
  - `tenantKind` (`'workforce' | 'externalId'`, absent = `'workforce'` for backward compatibility)
    distinguishes a standard Entra tenant from an Entra External ID (CIAM) tenant. The two use
    genuinely different login authorities — see `authService.ts`'s `buildAuthority()` — not just a
    different Cloud value: External ID's is `https://<externalIdSubdomain>.ciamlogin.com/<tenantId>/v2.0`,
    which needs its own field (`externalIdSubdomain`) since it can't be derived from `tenantId`
    alone. When `tenantKind` is `externalId`, `cloud` is always forced to `'public'` at the point
    the form saves the connection (`connectionFormLogic.ts`'s `resolveSubmit()`) — External ID has
    no sovereign-cloud equivalent of `usGov`/`china`, and the form hides the Cloud field entirely
    in that mode. Don't reintroduce a Cloud choice for External ID connections without resolving
    that.
- **Local file format**: one **YAML** file per downloaded artifact, close to the raw Graph schema,
  named `<displayName>__<id>.yaml`, plus a `_meta` block (`sourceConnection` name, tenant ID, Graph
  endpoint/API version, download timestamp). YAML specifically (not JSON) so files support comments.
- **One tree, two roots**: the extension exposes a single tree control with exactly two top-level
  nodes — **Connections** and **Project** — not two separate views. Both roots expand through the
  same shape (artifact-category folder → artifact-detail item); only where the data comes from
  differs. See UC029 for the full navigation model, including the already-downloaded indicator that
  requires cross-referencing between the two roots.
- **Extension host**: must run in the Node extension host, not as a web extension — MSAL's loopback
  listener and local filesystem access both require Node APIs.
- **Shared artifact viewer**: one webview component renders an artifact regardless of whether it
  came from a live Graph fetch (pre-download preview) or a local `.yaml` file (already downloaded)
  — same HTML/JS, just a different source badge. It is read-only by construction; hand-editing/
  annotating a local file happens through a separate "open raw file in text editor" command, never
  through the viewer. Comparisons (remote vs local) are the one exception that stays text-based,
  using VS Code's native diff editor, because the diff editor can't operate on webview content.

See `~/.claude/plans/moonlit-napping-eclipse.md` for the full planned architecture
(module layout, commands, settings, phased build order) — treat it as the current implementation
plan until it's superseded by actual code structure.

## Conventions

- TypeScript throughout.
- One "Entra" activity bar container holding one tree view with two roots: **Connections** (live,
  via Graph) and **Project** (local, reads the `entra/` folder) — keep the two branches' data
  sources separate internally even though they share one `TreeDataProvider`; the Project branch
  must work fully offline with no auth. Both feed the same shared artifact-viewer webview when the
  user views an item.
- Category folder/naming convention (mirrors the artifact scope above): `appRegistrations/`,
  `servicePrincipals/`, `groups/`, `directoryRoles/`, `externalId/userFlows/`,
  `externalId/customAuthExtensions/`.
