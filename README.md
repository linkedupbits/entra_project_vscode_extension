# Entra Artifacts

A VS Code extension for managing Microsoft Entra ID (Azure AD) objects as version-controllable,
YAML-based Infrastructure as Code, and for browsing/downloading artifacts already deployed in a
tenant via Microsoft Graph.

## What it does

- **Browse and download tenant artifacts (read-only in v1).** Add a named **connection** to an
  Entra tenant, authenticate (interactively, via device code, or app-only with a client
  secret/certificate), and browse app registrations & service principals, groups & directory
  roles, and Entra External ID (CIAM) user flows & custom authentication extensions via Microsoft
  Graph. Writing changes back to a tenant is out of scope for this version.
- **Define applications as local, deployable definitions.** Independent of the read-only download
  path above, an **application definition** is a hand-authored folder of four files
  (`AppConfig.yaml`, `Application.yaml.j2`, `FederatedCredentials.yaml.j2`,
  `ServicePrincipal.yaml.j2`) modelling one logical application's App Registration, Service
  Principal, and Federated Credentials, parameterised with [Nunjucks](https://mozilla.github.io/nunjucks/)
  (a Jinja2-compatible templating engine) so the same definition can later be rendered and deployed
  to multiple environments/tenants. The extension provides a structured, validating webview for
  browsing and editing these — actually rendering/deploying them to a tenant is a later phase.
- **One tree, two roots.** A single "Entra" activity bar view shows **Connections** (live, via
  Graph) and **Project** (local, reads the workspace's `entra/` folder) side by side.

See [Requirements/FunctionalRequirements.md](Requirements/FunctionalRequirements.md) for the full
functional scope and [Requirements/UseCases/](Requirements/UseCases/) for the detailed use cases
behind each piece of behavior.

## Status

Not all of the above is implemented yet — check before relying on this summary aging well:

- **Implemented**: adding/editing connections and authenticating (delegated and app-only); the
  full application-definition workflow — browsing, and the structured editor for an existing
  application's four files; and, for a connected connection, an **Applications** folder listing
  its live App Registrations via Graph, each selectable for a read-only, structured preview
  (Application / Federated Credentials / Service Principal) mirroring the local editor's layout,
  plus a **Download to project** button when the tenant's Service Principal carries an `AppName:`
  identifying tag — this seeds or updates the matching local application-definition folder rather
  than writing a flat downloaded-artifact snapshot.
- **Not yet implemented**: the other tenant artifact categories (Service Principals, Groups,
  Directory Roles, External ID user flows/custom auth extensions), the flat downloaded-artifact
  snapshot format for any category, comparing a preview with a local file, and actually
  rendering/deploying an application definition to a tenant.

[CLAUDE.md](CLAUDE.md) has the full list of architecture decisions and their rationale; the
[Requirements/](Requirements/) folder is the authoritative source of truth for scope and behavior
and is kept in sync with the code as it changes.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) — a current LTS release. The committed devcontainer pins an exact
  version (see below); if you're not using it, match that pin or use any reasonably recent Node
  LTS.
- [VS Code](https://code.visualstudio.com/) 1.90 or later.
- Optional but recommended: [Docker](https://www.docker.com/) and the
  [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
  extension, to use the committed devcontainer.

### Clone

```bash
git clone git@github.com:linkedupbits/entra_project_vscode_extension.git
cd entra_project_vscode_extension
```

### Option A — Devcontainer (recommended)

Open the cloned folder in VS Code and choose **Dev Containers: Reopen in Container** from the
Command Palette. This builds a container from
[`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json), pinned to a specific Node
major version, and installs dependencies automatically. See CLAUDE.md for what the devcontainer
does and why (bind mounts, SSH key handling, etc.) if you're modifying it.

### Option B — Local Node.js

Install dependencies directly:

```bash
npm install
```

### Build

```bash
npm run compile  # one-off production build (esbuild) -> dist/extension.js
npm run watch    # incremental build, rebuilds on save
```

### Run the extension

Open this folder in VS Code and press **F5** (or **Run > Start Debugging**). This runs the
`Run Extension` launch configuration, which builds via the `npm: watch` task and opens a new
**Extension Development Host** window with the extension loaded.

To try the application-definition workflow immediately, use **File > Open Folder** inside that new
window and open [`Example_Project`](Example_Project) — it already contains sample application
definitions under `entra/applications/`.

### Verify your changes

```bash
npm run check-types  # tsc --noEmit
npm run lint          # eslint src
npm run test          # vitest run
npm run coverage      # vitest run --coverage (enforces the thresholds in vitest.config.mts)
```

All four are expected to pass cleanly before a change is considered done — see
`NonFunctionalRequirements.md`'s coverage requirement for what's excluded and why.

### Packaging

There's no dedicated packaging script yet. The standard
[`vsce`](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) workflow
(`npx @vscode/vsce package`) will work as-is, since it invokes the `vscode:prepublish` script
(already wired to `npm run compile`) before bundling.

## Project layout

```
src/              Extension source (TypeScript)
Requirements/      Functional/non-functional requirements and use cases — source of truth
Architecture/      Design notes for not-yet-built capabilities (not decision records)
Example_Project/   Sample workspace content to open in the Extension Development Host
.devcontainer/     Pinned dev environment (see CLAUDE.md)
CLAUDE.md          Architecture decisions and conventions for anyone (or any AI agent) working on this repo
```

## License

MIT — see [LICENSE](LICENSE).
