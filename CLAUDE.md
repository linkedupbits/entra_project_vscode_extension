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
  (UC030–UC035). UC030 is **partially implemented**: a connected connection shows a single
  Applications (App Registrations) folder listing live Graph data; the other five artifact
  categories, auto-authenticating on expand, manual paging, throttling retry, and per-category
  permission errors are not — see UC030's own "Implementation status" note before assuming any of
  its main-flow steps beyond that one category are built. UC032 (Preview Artifact Before Download)
  and UC031 (Download Artifact) are both generic specs with no code of their own; UC034 and UC035
  are the concrete, implemented instances of them scoped to Applications, and are the ones to read
  for actual behavior — UC035 in particular does **not** follow UC031's flat-snapshot shape, so
  don't assume it does just because the name suggests it's "the download use case."
- `UseCases/UC400_ApplicationManagement/` — the on-disk structure for a locally-authored,
  deployable "application definition" (UC040 — **format only, not implemented**: don't assume any
  code creates a *new* application from scratch, renders its Nunjucks templates, or deploys it just
  because the format is specified); browsing what's already defined (UC041 — **implemented**:
  `applicationsBranch.ts`); and a structured, editable view of an *existing* application's four
  files (UC042 — **implemented**: `applicationEditorProvider.ts`/`applicationEditorHtml.ts`/
  `applicationFormLogic.ts`/`applicationStore.ts`; a second, plain-text combined-document editing
  surface also exists via `applicationDocumentProvider.ts` — see the "Application definitions"
  decision below for how the two relate).

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
- **Application definitions (UC040 format; UC041 browsing; UC042 structured editing — all implemented except the format's actual deploy path)**: a
  locally-authored, deployable unit distinct from the downloaded-artifact snapshot above — a folder under
  `<root>/Applications/<name>/` of four files. `AppConfig.yaml` isn't templated itself but is where
  the other three files' Nunjucks placeholders get their values from: application-wide metadata, a
  `Variables` block of defaults shared across environments, and an `Environments` list, each entry
  supplying one deployment target's own values (e.g. `tenancy_type: ciam`) — one render/deploy pass
  per entry. `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and `ServicePrincipal.yaml.j2`
  are each structured to mirror the Graph JSON body needed to create/update that resource. One
  thing not to silently resolve without revisiting UC040: `ServicePrincipal.yaml.j2`'s `appId` and
  `FederatedCredentials.yaml.j2`'s parent depend on `Application.yaml.j2` having been deployed
  first, for the same environment — these three files are sequenced per environment, not
  independent, and that `appId` placeholder resolves from that prior deploy step's result, not from
  `AppConfig.yaml` like the others. Whether `AppConfig.yaml`'s `tenancy_type` should unify with a
  connection's `tenantKind`, and how (or whether) an application definition relates to a downloaded
  artifact, are both still open — check UC040 before deciding either. UC042's editor constrains an
  Environment row's `tenancy_type` to a **Workforce**/**CIAM** dropdown (`applicationEditorHtml.ts`)
  rather than free text — the type itself is still a plain `string` (`types.ts`), so this is a UI
  constraint only, not a schema change, and a row's value that predates this change and matches
  neither is not specially preserved (same as the Required Permissions Type field's existing
  Scope/Role dropdown). Browsing (UC041) is real:
  `ProjectBranch` takes an `ApplicationsBranch` via constructor injection (like every other branch
  in this codebase) rather than constructing one internally, so it stays unit-testable with a fake.
  Because Project's subtree is now more than one level deep, `EntraTreeProvider`'s dispatch grew an
  `owns(element)` check on `ProjectBranch` — a deeper element neither root recognizes is offered to
  `ProjectBranch` a second time, with the element itself, before falling back to `[]`. An
  application node is a **leaf** (`TreeItemCollapsibleState.None`), not a folder — it does not
  expand to show its four backing files as separate children (an earlier version did; this was
  deliberately removed, since UC042's editor below is now the way to see and change all four files
  at once, and the raw files are still reachable via the "Open as Document" path). Clicking the
  application node itself opens UC042's editor: a VS Code **Custom Editor** tab
  (`ApplicationEditorProvider`, view type `entra.applicationEditor`) — not a plain `WebviewPanel` —
  specifically so the tab gets VS Code's native unsaved-changes dot and participates in native
  save/revert/close-with-prompt/hot-exit, none of which a plain `WebviewPanel` has any concept of
  (see UC042 for the full lifecycle and the reasoning behind `CustomDocumentContentChangeEvent`
  over the fuller, undo/redo-integrated `CustomDocumentEditEvent`). Right-clicking the application
  node and choosing **Open as Document** instead opens a second, simpler editing surface —
  `applicationDocumentProvider.ts`'s `vscode.FileSystemProvider`-backed virtual document
  (`entra-application:` scheme) that combines all four files into one plain YAML text document,
  getting VS Code's dirty-tracking for free since it's a real `FileSystemProvider`-backed document
  rather than a webview. The two editing surfaces are independent and read/write the same
  underlying files through the same `ApplicationStore`; neither is a replacement for the other. The
  Custom Editor's own virtual identity (`entra-application-editor:` scheme, distinct from the
  document provider's `entra-application:` scheme so the two never collide over one URI) carries the
  real folder URI in its **query string**, not its path — VS Code derives a Custom Editor's tab
  title from the URI's path basename and ignores `webviewPanel.title` entirely (a VS Code
  limitation, not a choice made here), so the path is kept to just the plain application name
  (`applicationEditorUri.ts`) purely so the tab reads e.g. "sample-web-app" rather than a
  URL-encoded folder path. All four files are genuinely structured (add/remove
  rows for every list-shaped field), not raw text areas — this was a deliberate later change from
  an earlier version of this form that kept the three `.yaml.j2` templates as opaque textareas
  specifically to avoid losing comments/Nunjucks syntax on save; the user explicitly overrode that
  caution and accepted the tradeoff below. `Application.yaml.j2` is a **Display name** field, a
  **Sign-in audience** `<select>` (the four real Graph values),
  and a dynamic **Required permissions** list — Graph's nested
  `requiredResourceAccess[].resourceAccess[]` shape is flattened to one flat `RequiredPermission`
  row (`resourceAppId`/`id`/`type`) per individual permission for editing (`normalizeApplicationFields()`
  in `src/applications/types.ts`), then regrouped back to the nested shape on save
  (`groupRequiredPermissions()`) — this avoids a two-level nested dynamic list in the webview. A
  row's `resourceAppId` is itself a dropdown (`applicationEditorHtml.ts`), not free text: **Microsoft
  Graph** (storing `wellKnownPermissions.ts`'s `MICROSOFT_GRAPH_APP_ID` constant) plus one option
  per reference key currently in the same form's **Dependencies** section, storing the Jinja
  reference `{{ dependency_refs.<key>.applicationId }}` Dependencies itself already uses — the type
  stays a plain `string` (`RequiredPermission.resourceAppId`), so this is a UI constraint on how
  that string gets written, not a schema change. `resourceAppIdReference.ts`'s
  `parseResourceAppId()`/`buildDependencyReference()` are the real, tested logic behind this (used
  both for the initial server-rendered choice of dropdown-vs-text and, duplicated in the webview's
  own vanilla JS — it can't import a TypeScript module into its isolated script context — for
  keeping the dropdown's Dependency options live as the user edits Dependencies rows in the same
  session). A `resourceAppId` already on disk that's neither the well-known Graph ID nor a reference
  to a *currently defined* Dependencies key — checked once at open, not continuously — renders as
  plain text with a ⚠ warning icon instead of the dropdown, so a hand-edited value, a reference to a
  since-renamed/removed dependency, or an unmodelled third-party GUID is never silently discarded or
  misrepresented; a freshly added row always starts as a working dropdown.
  A row's **Permission ID** is also a dropdown (rather than free text), populated from whichever
  resource that row's `resourceAppId` currently selects — `permissionIdOptions.ts`'s
  `buildPermissionOptionsByResourceAppId(store, dependencies)` builds one `Record<resourceAppId,
  PermissionOption[]>` (keyed by the exact string that appears in the `resourceAppId` dropdown, so a
  lookup needs no re-parsing) covering **both** cases in one pass: Microsoft Graph's options come
  from `wellKnownPermissions.ts`'s checked-in catalogue (no I/O), each option's `id` its real, fixed
  Graph permission GUID; each Dependency's options come from actually loading *that other
  application's own* `Application.yaml.j2` via the same `ApplicationStore` (`store.load()` on
  `<applications root>/<dependency's AppName>`) and reading its own **Exposed API scopes**
  (`oauth2PermissionScopes`) — the delegated scopes it exposes, since this schema has no local
  equivalent of an application-permission Role to offer for a dependency (`appRoles` isn't
  modelled) — but each such option's `id` is deliberately the scope's own `value` (its name, e.g.
  `access_as_user`), **not** its GUID: a dependency's scope GUID isn't necessarily fixed at
  authoring time (it may itself be an `{{ environment.Variables.<key> }}` reference — see
  `oauth2ScopeIdReference.ts`), so `resourceAccess[].id` can't hardcode it the way it can for Graph;
  storing the scope's `value` instead defers the actual lookup to deploy time, matching this
  dependency's *deployed* scope by that `value` — the same deferral `{{
  dependency_refs.<key>.applicationId }}` already relies on for `resourceAppId` itself. This is
  computed once per render (`ApplicationEditorProvider.render()`), not
  recomputed client-side, since it needs real file reads the webview's own script can't do — a
  dependency added in the same editing session won't have Permission ID options until the tab is
  reopened/reverted, an accepted, documented limitation. A dependency that fails to load or exposes
  nothing contributes no options for its resourceAppId rather than breaking the others (a per-item
  try/catch, not `Promise.allSettled`, since there's no need to inspect individual rejection
  reasons). `applicationEditorHtml.ts`'s `permissionIdFieldHtml()` (TS, initial render) and its
  duplicated `permissionIdCellHtml()` (the webview's own JS, since it can't import a TS module)
  decide dropdown-vs-text per row exactly like `resourceAppId` already does — a blank ID isn't a
  warning (an unfinished new row), but a non-blank one that doesn't match any *known* option for
  that resource is. Unlike `resourceAppId`'s Dependency options (which live-refresh from the
  Dependencies section's own DOM state), a row's Permission ID options only rebuild on that row's own
  `resourceAppId` `change` event — not on every edit — specifically so rebuilding the Permission ID
  cell (which can swap between a `<select>` and a text `<input>`) never interrupts someone typing
  into an unrelated field, or even into that row's *own* Permission ID text-input fallback. That
  rebuild (`refreshPermissionIdCell()`) always resets the Permission ID to blank rather than
  re-checking whatever was previously selected/typed against the new resource's options — a Graph
  GUID and a dependency's scope `value` are different namespaces entirely, so carrying one forward
  across a resource switch was a real bug (not a deliberate choice): it showed up as a spurious
  ⚠-flagged raw value the new resource never actually had, rather than a fresh, correct dropdown.
  Picking a
  known Permission ID from its dropdown also auto-sets the row's `Type` to that permission's own type
  (via a `data-type` attribute on each `<option>`) — deliberately not left as a second, independently
  wrong-able choice, since a real permission's type isn't actually separable from its ID. No network
  call is involved anywhere in this — UC042 stays entirely local/offline, same as everything else in
  it; a third-party `resourceAppId` this dropdown doesn't otherwise recognise (see above) simply has
  no Permission ID options either, falling back to text the same way its own `resourceAppId` does.
  A dynamic **Exposed API scopes** list mirrors Required Permissions in reverse: it edits
  `Application.yaml.j2`'s `api.oauth2PermissionScopes` (`Oauth2PermissionScopeEntry` in `types.ts`,
  fields matching Graph's `permissionScope` type exactly, one row per scope, no
  flatten/regroup needed since it's already a flat Graph array) — delegated scopes this application
  *exposes*, rather than what it requests. Each scope renders as its own collapsible `<details>`
  card (`oauth2PermissionScopeRowsHtml()`), not a single-line row like the rest of this form's
  dynamic lists (Federated Credentials below got the same treatment, for the same reason) — one
  scope has eight fields, several of them long free-text descriptions, so a flat row would wrap
  unreadably. Collapsed is the default for a scope loaded from disk (no `open` attribute); a scope
  added via **+ Add scope** starts expanded instead (`addOauth2ScopeRow()` sets `.open = true`),
  since it needs immediate input. `<summary>` shows a live-updating one-line label (`Scope value` —
  `ID variable name` if set) built by `oauth2ScopeSummaryLabel()`, kept in sync as those two fields
  change by `refreshOauth2ScopeSummaries()` (called from `notifyEdit()`, same as
  `refreshPermissionResourceAppIdOptions()`) — duplicated server/client exactly like the other
  TS/webview-JS pairs in this file. Every field inside the card has a real `<label>` (implicit
  association — `<label>text<input/></label>`, no generated `id`/`for` pair needed since rows are
  cloned dynamically); the **Enabled** checkbox already used this pattern before the rest of the
  card did. Putting the row's own remove button inside `<summary>` meant `onRemoveClick()` needed
  `event.preventDefault()`/`stopPropagation()` — added unconditionally for all row types (harmless
  for the others, since a `type="button"` has no default action to prevent anyway), since without
  it a click on that button would also toggle the card's collapsed state before removing it.
  `appendRow()` grew an optional `tagName` parameter (defaulting to `'div'`, as before) so this
  section alone can build a `<details>` instead. Each row's Graph-required `id` (a GUID Graph uses to
  match a scope across updates) is generated automatically for a new/id-less row
  (`applicationEditorHtml.ts`'s `oauth2PermissionScopeRowsHtml()`/`addOauth2ScopeRow()`, via
  `crypto.randomUUID()`) and otherwise left alone — unless the row's optional **ID variable name**
  field is filled in, in which case `resolveOauth2PermissionScopes()` in `applicationFormLogic.ts`
  writes the id as `{{ environment.Variables.<name> }}` instead
  (`oauth2ScopeIdReference.ts`'s `buildEnvironmentVariableIdReference()`/`parseEnvironmentVariableIdName()`,
  the same templating idea `dependency_refs` already uses) — clearing that field back to blank falls
  back to the row's last raw id rather than writing a broken reference to an empty name. Whenever
  any scope resolves to such a reference, `resolveApplicationSubmit()` calls
  `ensureOauth2ScopeIdVariablesInEnvironments()` to guarantee that variable name is a key in *every*
  environment's own `Variables` map (see `EnvironmentEntry.Variables` below), generating a fresh GUID
  for any environment that doesn't already have one — never overwriting one that does.
  `EnvironmentEntry` (`types.ts`) grew a `Variables: Record<string, string | string[]>` field for
  exactly this — each environment's own values, distinct from `AppConfig.yaml`'s shared top-level
  `Variables` (which stay `Record<string, string>`). The value type is a `string | string[]` union
  because **redirect URIs are modelled per environment, not on the App Registration** (an explicit
  user decision — they legitimately differ per deployment target): each environment card has three
  dynamic redirect-URI lists (Web / Public client / SPA), stored as *array*-valued entries in that
  environment's own `Variables` under the keys `web_redirectUris` / `publicClient_redirectURIs` /
  `spa_redirectURIs` (the inconsistent `Uris`/`URIs` casing is deliberate — `ENVIRONMENT_REDIRECT_URI_VARIABLE_KEYS`
  in `types.ts` is the single source of truth for them). `Application.yaml.j2` carries **no** redirect
  URIs of its own now — `ApplicationFields.redirectUris` was removed entirely, along with the
  App-Registration-section "Redirect URIs" list, `serializeApplication`'s `web` block, and
  `normalizeApplicationFields`'s read of it. UC034's tenant preview still needs redirect URIs, so it
  reads the raw `web`/`publicClient`/`spa.redirectUris` off the Graph fetch into three side fields on
  `ApplicationPreviewData` (`webRedirectUris` etc. — the same "tenant data that doesn't fit
  `ApplicationFields`" pattern `applicationPublisherDomain` already uses) and shows all three;
  UC035's download seeds them into the new `Environments` entry's `Variables`. `normalizeAppConfig`
  reads env Variables through `asEnvironmentVariablesRecord` (accepts string arrays; still skips the
  `<<` merge-key object); the generic "Variables owned by this environment" list and its
  `overridesOnly()` feed exclude the three redirect keys (they have their own lists). The
  whole **Environments** section is a collapsible box (collapsed by default, its summary carrying a
  live count), and each environment inside it is *itself* a collapsible `<details>` card with
  labelled fields — the same treatment (and shared CSS/`refresh*Summaries()` machinery, plus the
  same `.environment-card` addition to `onRemoveClick`'s `closest()` selector) as the Exposed API
  scopes / Federated Credentials cards. Every one of these collapsible summaries draws its own
  `::before` disclosure chevron (rotated under `details[open]`) because the native `<summary>`
  marker disappears the moment a summary is `display: flex` — a real gotcha, don't remove those
  rules thinking the browser will fall back to the default triangle. Each environment card carries a **Variables owned by this
  environment** key/value list, editable just like the top-level shared Variables; it's populated
  with `types.ts`'s now-exported `overridesOnly(env.Variables, appConfig.Variables)` — i.e. the
  environment's own keys only, since the shared defaults are edited once up top. `EnvironmentRowInput.variables`
  is a `VariableRowInput[]` (was a carried-through `Record` behind a hidden JSON field);
  `resolveApplicationSubmit` runs it (and the top-level list) through one shared `resolveVariableRows()`
  helper — a blank row is a spacer, a keyless value or a duplicate key blocks the save with a
  `missing`/`duplicateEnvironmentVariableKey` (naming the environment) or the plain
  `missing`/`duplicateVariableKey`. `resolveApplicationSubmit` also folds each environment row's
  three redirect-URI arrays (trimmed, blank-filtered) into its `Variables` under the three redirect
  keys, omitting an empty one; a row that's blank apart from a redirect URI still blocks save with
  `missingEnvironmentName` rather than being dropped as a spacer. Per-environment `+ Add variable`
  and the three `+ Add … redirect URI` buttons have no fixed id (N of them, addable at runtime) so
  they're handled by one delegated `form` click listener rather than wired individually. `resolveApplicationSubmit()`'s `mergeDefaultVariablesIntoEnvironments()` then
  copies the shared top-level `Variables` into every environment's own map (environment-specific
  values win on a key clash) before the id-variable-name pass runs, so `EnvironmentEntry.Variables`
  in memory always holds each environment's *full effective* set — this mirrors, and is meant to
  have the same practical effect as, hand-authoring `Variables: &DefaultVariables` plus per-environment
  `<<: *DefaultVariables` (UC040's own convention, restored on user request after an earlier version
  of this merge just wrote flattened literal values and lost the anchor/alias syntax entirely). The
  actual anchor/alias *is* reconstructed on disk: `types.ts`'s `buildAppConfigNode()` builds
  `AppConfig.yaml`'s node via the `yaml` package's `Document`/`Node` API (not a plain-object
  `YAML.stringify()`, which has no way to express an alias) — it anchors the shared `Variables` node
  once (`&DefaultVariables`) and, for each environment, writes only that environment's *overrides*
  (a key that's new or has a different value than the shared default) alongside a `<<` alias
  pointing at the anchor, so a human reading the file sees the same shape as if they'd hand-authored
  it. Both `ApplicationStore` and `applicationDocumentContent.ts`'s combined virtual document use
  `buildAppConfigNode()` for writing `AppConfig.yaml`, and both parse it back with `{ merge: true }`
  (a `yaml` package option, off by default) so the merge key actually resolves into each
  environment's full effective set again instead of parsing as a literal, useless `"<<"` key —
  `types.ts`'s `asVariablesRecord()` additionally guards against exactly that literal-`<<`-key case
  (an object-shaped Variables value) by skipping it rather than `String()`-coercing it into
  `"[object Object]"`, a real corruption this schema hit in practice before merge-key parsing was
  turned on everywhere it needed to be.
  `FederatedCredentials.yaml.j2` is a dynamic list of `name`/`issuer`/`subject`/`description` fields
  per credential, with `audiences` (a Graph list, but almost always single-valued) edited as one
  comma-separated text field, split/joined programmatically rather than as a nested list-of-lists.
  Each credential gets the same collapsible-`<details>`-card treatment as Exposed API scopes above,
  and for the same reason (`federatedCredentialRowsHtml()`/`addFedCredRow()`) — collapsed by default
  when loaded, expanded when newly added, `<summary>` showing a live `Name — Subject` label
  (`fedcredSummaryLabel()`/`refreshFedCredSummaries()`, the same server/client-duplicated pattern).
  `ServicePrincipal.yaml.j2` is `appId`/`appRoleAssignmentRequired` (checkbox)/a dynamic `tags` list.
  The Tags area also shows a **read-only, display-only** "Generated tags" preview — four tags
  (`AppName:<Environment>_<businessUnit>_<appName>`, `Environment:{{Environment}}`, `<appName>`,
  `BusinessUnit:<businessUnit>`) computed live in the webview's own JS from the Application
  name/Business unit inputs as the user types (`updateGeneratedTags()` in `applicationEditorHtml.ts`).
  `<Environment>`/`{{Environment}}` are deliberately never substituted — there's no single
  environment value at this point in the form, since one definition renders once per
  `Environments` entry (UC040). This was an explicit product decision, confirmed with the user:
  these tags are **not** written to `ServicePrincipal.yaml.j2`'s `tags` array by this form — future
  deploy tooling is expected to apply them automatically at deploy time, not this use case. Don't
  "complete" this by merging the preview into `resolveServicePrincipal()`/`serializeServicePrincipal()`
  without re-confirming that decision; it was deliberate, not an oversight. Because these prefixes
  are reserved for that deploy-time-applied preview, `resolveApplicationSubmit()` in
  `applicationFormLogic.ts` is the one place in the Application/FederatedCredentials/ServicePrincipal
  sections with real hard validation beyond structural cleanup: a custom tag starting with
  `AppName:`, `Environment:`, or `BusinessUnit:` (case-sensitive, matching the preview's own casing)
  is rejected on save (`reservedTagPrefix`), so a hand-typed tag can never collide with a generated
  one.
  `AppConfig.yaml` also carries a `Dependencies` map (`{ <referenceKey>: { AppName: <folder-name> } }`)
  recording a deploy-time dependency on another application definition in the project, resolved
  from a template as `{{ dependency_refs.<referenceKey>.applicationId }}` once deploy tooling
  exists (see `Architecture/future_considerations.md`) — this only records the relationship, it
  doesn't resolve anything itself. The form's `AppName` field is a `<select>` populated from
  `ApplicationsBranch.listApplicationNames()` (the current application excluded), not free text —
  an explicit product decision so a dependency can't be saved pointing at an application that
  doesn't exist in the project; `ApplicationEditorProvider`'s constructor therefore takes an
  `ApplicationsBranch` alongside the `ApplicationStore` it already needed. A stale saved reference (folder since
  renamed/deleted) is still rendered as a selectable option so re-saving the form doesn't silently
  drop it. Saving parses-to-object-then-restringifies all four files fresh (`applicationStore.ts`, same
  approach as `connectionStore.ts`), so — documented in UC042, not silently accepted — it drops any
  hand-written comment in any of the four files, an environment's extra keys beyond the fixed ones
  this form exposes, and any `Application`/`FederatedCredentials`/`ServicePrincipal` key this form
  doesn't model (e.g. `identifierUris`, `appRoles`, `implicitGrantSettings` — already removed from
  `Example_Project`'s sample data for this reason). This is an explicit, accepted tradeoff: the user
  directed it, on the basis that a developer reviews the `git diff` this form produces before
  committing and can re-add anything dropped. Don't "fix" that by inventing a merge/preserve step
  without deciding it's worth the complexity; it was a deliberate scope call, not an oversight. The
  one exception, built deliberately (not a gap in the above): `AppConfig.yaml`'s own
  `Variables: &DefaultVariables` / per-environment `<<: *DefaultVariables` merge key *is*
  reconstructed on every save, via `types.ts`'s `buildAppConfigNode()` — see its own doc comment for
  how (it uses the `yaml` package's `Document`/`Node` API, not a plain-object `YAML.stringify()`,
  which has no way to express an alias) and `EnvironmentEntry.Variables`'s doc comment for how the
  in-memory shape (always each environment's full, already-merged effective set) differs from what's
  actually written to disk (each environment's overrides only, aliasing the rest). This requires
  `{ merge: true }` wherever this schema is parsed back (`ApplicationStore`/
  `applicationDocumentContent.ts`) — without it, `<<` parses as a literal, useless map key instead
  of resolving.
- **One tree, two roots**: the extension exposes a single tree control with exactly two top-level
  nodes — **Connections** and **Project** — not two separate views. Both roots are meant to expand
  through the same shape (artifact-category folder → artifact-detail item); today that shape is
  real on both sides but only for one category each — **Applications** under Project (UC041, local
  files) and **Applications** under a connected connection (UC030, live Graph data; with an extra
  **Environment: &lt;name&gt;** grouping level between folder and detail — see UC030 A5). See UC029 for
  the full navigation model, including the already-downloaded indicator that requires
  cross-referencing between the two roots (not yet implemented, since it needs the
  downloaded-artifact side too).
- **Tenant Applications browsing (UC030, partial)**: a `ConnectionTreeItem` is expandable
  (`Collapsed`) once `authService.isConnected()` is true for it, and a leaf (`None`) otherwise —
  clicking it still opens Edit Connection either way (UC029 A5), since VS Code treats a click on
  the label and a click on the expand chevron as independent gestures. Expanding a connected
  connection shows one fixed child, `TenantApplicationsRootItem` ("Applications"); expanding *that*
  calls `AuthService.getGraphAccessToken()` (silent for delegated, client-credentials for app-only
  — reacquired on every expand, not cached separately here, since MSAL's own cache already avoids
  a redundant network call) and `graphClient.ts`'s `listApplications()`, which follows every
  `@odata.nextLink` internally before returning — no manual "Load more" UI, unlike UC030's original
  spec (see UC030 for that trade-off's rationale). `ConnectionsBranch` catches anything that fails
  along that path (token acquisition or the Graph call itself) and renders a single
  `tenantApplicationsError` tree item instead of throwing out of `getChildren()`, which would
  otherwise surface as a silently-empty node.
  - **Environment grouping (UC030 A5)**: the Applications list is grouped by logical environment.
    Alongside `listApplications()`, `getApplications()` also calls `graphClient.ts`'s
    `listServicePrincipals()` (`$select=id,appId,displayName,tags`, same auto-paging) and builds an
    `appId → tags` map, then `groupApplicationsByEnvironment()` emits one
    `TenantApplicationEnvironmentGroupItem` ("Environment: &lt;name&gt;", `Collapsed`, contextValue
    `tenantApplicationEnvironmentGroup`, carrying its already-sorted `GraphApplication[]`) per
    distinct value returned by `tenantApplicationIdentity.ts`'s `environmentTagValue()` (first
    `Environment:` tag on the matching Service Principal; blank/whitespace value → ungrouped;
    `{{Environment}}` placeholder kept as a real group). Group nodes sort first by env name, then
    ungrouped `TenantApplicationItem`s (no SP, or SP with no `Environment:` tag), each list by
    display name. The group node is a third tree level under Applications, so `owns()` recognises it
    and `getChildren()` maps its stored applications to `TenantApplicationItem`s (no refetch).
    **Degradation**: a failed `listServicePrincipals()` call (e.g. missing `ServicePrincipal.Read.All`)
    is swallowed in `servicePrincipalTagsByAppId()` → empty map → flat ungrouped list, rather than
    an error item; only a failed `listApplications()` (or token acquisition) still yields
    `tenantApplicationsError`. Reads the tag from the **Service Principal**, not the app
    registration — matches UC034/UC035's existing tag handling (`hasEnvironmentTag()` etc.).
  `graphHosts.ts`'s `GRAPH_HOST` map is the one place
  the three sovereign-cloud Graph hostnames are written down — `authService.ts`'s `GRAPH_RESOURCE`
  (token audience) and `graphClient.ts`'s REST base URL both derive from it, so a hostname is never
  duplicated. The other five categories UC030 specifies (Service Principals, Groups, Directory
  Roles, External ID User Flows/Custom Authentication Extensions), throttling retry, and
  per-category 403 handling are not implemented — don't assume `ConnectionsBranch` has any of that
  just because Applications works.
- **Application artifact preview (UC034, the implemented instance of UC032), structured to match
  UC042**: clicking a `TenantApplicationItem` runs `entra.previewArtifact`, which calls
  `connections/tenantApplicationPreview.ts`'s `loadApplicationPreview()` — three independent Graph
  calls via `Promise.allSettled` (`graphClient.ts`'s `getApplication()`,
  `listFederatedIdentityCredentials()`, `getServicePrincipalByAppId()`, the last looked up by
  `appId` via `$filter`, since Graph doesn't nest a Service Principal under its Application), each
  normalized through the *same* `applications/types.ts` functions (`normalizeApplicationFields()`,
  `normalizeFederatedCredentials()`, `normalizeServicePrincipalFields()`) UC042's local editor
  already uses — deliberate reuse, not a parallel implementation, so a tenant application and a
  local one are guaranteed the same field mapping and the same unmodelled-field limitations
  (`identifierUris`, `appRoles`, etc. — see UC034). Redirect URIs are the exception: UC042 no longer
  models them on `ApplicationFields` (they're per-environment now), so `loadApplicationPreview()`
  reads the raw `web`/`publicClient`/`spa.redirectUris` straight off the fetch into three
  `ApplicationPreviewData` side fields and `buildApplicationPreviewHtml()` shows all three lists. A
  failure in any one of the three calls (a
  rejected `Promise.allSettled` entry) becomes that section's own `{ kind: 'error', message }`
  rather than failing the other two — only a failure acquiring the access token itself (before any
  of the three calls) aborts the whole preview. `connections/applicationPreviewHtml.ts`'s
  `buildApplicationPreviewHtml()` (a pure function, genuinely unit-tested — not glue) renders a
  **Unique name** line (see below) plus the three sections read-only (labels/lists, no inputs),
  including a **Dependencies** list under the Application section (UC035 A6 — see below).
  `webview/artifactViewerPanel.ts`'s `ArtifactViewerPanel` is a reusable **shell**
  (title/badge/hint/Download-button chrome plus shared CSS) that takes arbitrary caller-built
  `bodyHtml` — it no longer assumes YAML-in-a-`<pre>`, so a future artifact type can supply its own
  structured body through the same shell. It's keyed by `<connection name>::<object id>` so
  re-selecting the same application reveals/refreshes its existing panel rather than opening a
  duplicate. `artifactViewerPanel.ts` is excluded from coverage as thin webview glue, same as
  `connectionFormPanel.ts`/`applicationEditorHtml.ts` (UC042's own HTML/CSS/JS template, split out
  from `applicationEditorProvider.ts` specifically so that file's lifecycle logic — save/revert/
  backup/message-handling — stays testable and NOT exempted) — but `tenantApplicationPreview.ts` and
  `applicationPreviewHtml.ts` are not, since they hold real logic (the per-section failure
  isolation, the field rendering) rather than VS Code wiring. Still not built: the `_meta` block
  UC020/UC032 describe, "Compare with local file," or support for any artifact category besides
  Applications — see UC034 for the full list.
- **Unique name + Download (UC035, resolving one of UC040's open questions for Applications)**:
  `connections/tenantApplicationIdentity.ts`'s `parseTenantApplicationIdentity()` is a small, pure
  parser for the `AppName:<Environment>_<BusinessUnit>_<AppName>` tag UC042's Generated tags
  preview already describes — it requires the tag's value to split into exactly three non-blank
  underscore-separated parts, returning `undefined` rather than guessing on anything else (a
  malformed match would silently target the wrong folder on download, worse than refusing).
  `applicationPreviewHtml.ts` calls it to render UC034's **Unique name** line (an explicit
  "not found" state, never silently omitted).

  The Download button in `ArtifactViewerPanel` is **always** shown now (its `onDownload` callback
  parameter is no longer conditional on a parsed identity) — `entra.previewArtifact` in
  `extension.ts` calls `parseTenantApplicationIdentity()` on click, and if it returns `undefined`,
  falls back to `promptForApplicationName()` (UC035 A4, a thin but genuinely unit-tested
  `showInputBox` wrapper, same pattern as `resolveConnectionArg.ts`) rather than refusing. That
  fallback only ever collects `appName`; `tenantApplicationIdentity.ts`'s `ApplicationDownloadTarget`
  type (broader than `TenantApplicationIdentity`: `environment`/`businessUnit` optional) is what
  `downloadApplicationToProject()` actually accepts, so it can skip the AppConfig.yaml
  business_unit/Environments merge steps cleanly when those two are unknown rather than writing
  guessed values.

  `downloadApplicationToProject()` — the one significant design decision in this feature — does
  **not** write a flat downloaded-artifact snapshot (UC020/UC031's shape). It instead seeds/merges
  into the *existing* `ApplicationStore`-managed folder for `<AppName>` (UC040), non-destructively:
  `ApplicationStore.existingTemplateFiles()` (reads the directory listing rather than adding a new
  `stat`-based mock surface) tells it which of the three `.yaml.j2` files already exist, and only a
  missing one is written from the previewed data — an existing one is assumed to be a hand-authored
  Nunjucks template and is never touched. Before writing a new `ServicePrincipal.yaml.j2`, its
  `tags` are filtered through `stripGeneratedTags()`, which drops anything matching
  `applicationFormLogic.ts`'s now-exported `reservedTagPrefixFor()` (`AppName:`/`Environment:`/
  `BusinessUnit:`) plus an exact match on the bare app name (the fourth generated tag) — without
  this, a downloaded file would immediately fail that same file's own reserved-prefix validation
  the next time it's opened in UC042 and saved. When appending a new `Environments` entry, its
  `publisherDomain`/`tenancy_type` are populated from the connection/fetched application (see
  `tenancyTypeFor()`: `externalId` → `'ciam'`, else `'workforce'`) only if the Service Principal
  also carries a separate `Environment:` tag (`hasEnvironmentTag()`, presence-only — its value may
  still be the unresolved `{{Environment}}` placeholder) — otherwise left blank, unchanged from
  before this enrichment existed. `publisherDomain` itself comes from the raw application object's
  own Graph `publisherDomain` field, captured by `tenantApplicationPreview.ts` as
  `ApplicationPreviewData.applicationPublisherDomain` since `ApplicationFields`/UC042 don't model
  it. The new entry's `Variables` are seeded with the previewed application's redirect URIs
  (`web_redirectUris`/`publicClient_redirectURIs`/`spa_redirectURIs` array values, each omitted when
  empty) from the same `ApplicationPreviewData` side fields. Requires all three of UC034's sections
  to have loaded successfully (`kind: 'ok'`) — refuses
  to download, rather than writing a misleadingly empty file, if any one failed.
  `tenantApplicationIdentity.ts`, `promptForApplicationName.ts`, and
  `downloadApplicationToProject.ts` are all genuinely unit-tested, not glue.
  - **Dependencies derived from Required Permissions (UC035 A6)**: `applicationDependencies.ts`'s
    `deriveApplicationDependencies(requiredPermissions, resourceApplications, existingDependencies)`
    (pure, unit-tested) walks every distinct non-Microsoft-Graph `resourceAppId`
    (`resourceAppId !== MICROSOFT_GRAPH_APP_ID`, from `resourceAppIdReference.ts`) and produces an
    `AppConfig.yaml` `Dependencies` entry for it plus a rewritten `requiredPermissions` array: each
    such row's `resourceAppId` → `{{ dependency_refs.<key>.applicationId }}`, **and** its `id` → the
    resolved permission's `value`/name (from `resourceApplications[appId].permissions[id].name`)
    instead of the tenant GUID — UC042's Permission Editor keys a dependency scope by value, not
    GUID (`permissionIdOptions.ts`), so a GUID would render as a ⚠ unrecognised value. A row whose
    permission the live lookup didn't expose keeps its original `id`; Graph rows are returned
    unchanged (Graph GUIDs are fixed). Key = the resource's resolved `displayName` squashed to
    `[A-Za-z0-9]` (matching UC040's own `SampleAPIApp` example), or the raw `appId` when unresolved
    (no SP in tenant — user's explicit choice) or when that key already belongs to a different
    `AppName`. Existing `Dependencies` are merged, never overwritten; an entry already pointing at
    the same `AppName` is reused for the rewrite. `downloadApplicationToProject()` runs this **only
    when writing a fresh `Application.yaml.j2`** (`!existingTemplates.application`) — it then sets
    `appConfig.Dependencies` to the merged map and writes `derivation.requiredPermissions`; an
    existing hand-authored template and its `Dependencies` map are both left untouched.
    `applicationPreviewHtml.ts` calls the same function (with `{}` for existing deps) to render
    UC034's read-only **Dependencies** list under the Application section — resolved as `name
    (appId)`, unresolved flagged; Microsoft Graph never listed.
- **Required Permissions name resolution (UC034 preview only), static for Microsoft Graph + live
  for everything else**: UC034's Required Permissions rows render as
  `<Application name> : <Scope name> (<Application ID> : <Scope ID>)` — the IDs are always shown,
  never replaced, so a name that can't be resolved just falls back to its own raw ID in place,
  never blocking the row. Two resolution paths feed `applicationPreviewHtml.ts`'s
  `permissionsListOrNone()`, unified through one shared shape, `graphClient.ts`'s
  `GraphResourceApplication` (`{ displayName, permissions: Record<id, {name, type}> }`):
  - **Microsoft Graph** (`resourceAppId === '00000003-…'`) resolves from
    `graph/wellKnownPermissions.ts`'s `getWellKnownResourceApplication()` — no network call at
    preview time. Backed by a checked-in JSON catalogue
    (`graph/wellKnownPermissions/microsoftGraph.json`) containing the **complete, real** Microsoft
    Graph permission set (1131 entries as of writing) — not hand-typed, not a fabricated/seed
    list. It's regenerated by `scripts/downloadGraphPermissions.js`, a standalone Node CommonJS
    dev tool — **not** part of the extension bundle, not TypeScript, not linted by `npm run lint`
    (which only targets `src`) — which by default (`npm run download:graph-permissions`, no
    arguments, no credentials) fetches Microsoft's own public, unauthenticated permissions
    catalogue:
    `https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/master/permissions/permissions-descriptions.json`
    (`applicationScopesList` → `type: 'Role'`, `delegatedScopesList` → `type: 'Scope'`) — verified,
    not assumed, by fetching and cross-checking it against already-known GUIDs before relying on
    it. This is a static file on a community/devx-tooling repo, not a documented/versioned/SLA'd
    public API, so its path could move without notice; `--from-tenant --client-id <id>` falls back
    to the original approach (MSAL device code flow, then a live
    `GET /v1.0/servicePrincipals?$filter=appId eq '00000003-…'&$select=appRoles,oauth2PermissionScopes`
    call) if that ever breaks or a more authoritative source is needed. Don't hand-expand the JSON
    file with guessed IDs; rerun the script instead. `tsconfig.json` gained
    `resolveJsonModule: true` specifically so `wellKnownPermissions.ts` can `import` that JSON file
    with type-checking (its inferred `type` field widens to `string`, so it's cast back to the
    narrower `'Role' | 'Scope'` union once, at the import site).
  - **Any other `resourceAppId`** resolves at runtime via `graphClient.ts`'s
    `getResourceApplicationPermissions()` — the exact same kind of
    `GET /v1.0/servicePrincipals?$filter=appId eq '{resourceAppId}'&$select=displayName,appRoles,oauth2PermissionScopes`
    call as the Microsoft-Graph-specific one above, just aimed at whatever resource a permission
    row references, since there is no static catalogue for anything but Microsoft Graph.
    `tenantApplicationPreview.ts`'s `resolveResourceApplications()` collects every *distinct*
    non-Graph resourceAppId from the previewed application's `requiredPermissions` and looks each
    up exactly once (not once per permission row, and not for duplicates across rows), via
    `Promise.allSettled` — a lookup that fails, or finds no Service Principal, simply leaves that
    resourceAppId absent from `ApplicationPreviewData.resourceApplications`, isolated from every
    other resource and from the three main sections (unlike a UC034 A1 section-level error, this
    never blocks anything else).

  Extending this resolution to UC042's local, editable Required Permissions list was explicitly
  left undone — see UC034's own note on that boundary.
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
