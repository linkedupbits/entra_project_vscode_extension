# Future Considerations — Deploy Tooling for Application Definitions

Analysis written 2026-09-05. This is a design/options doc, not a decision record — nothing here
is committed to. It exists so a future decision about deploy tooling starts from a considered
baseline instead of re-deriving it from scratch. Revisit once
[UC040](../Requirements/UseCases/UC400_ApplicationManagement/UC040_DefineApplication.md)'s open
questions are resolved and real deploy tooling is on the roadmap.

## Context

[UC040](../Requirements/UseCases/UC400_ApplicationManagement/UC040_DefineApplication.md) specifies
the on-disk format for a locally-authored **application definition** (`AppConfig.yaml` +
three Nunjucks-templated files) but explicitly stops at the format — no code renders, validates, or
deploys one yet. Three future capabilities would build on that format:

1. A common **precompile/deployment library** — renders the Nunjucks templates per environment and
   deploys the result to Entra via Graph, in the sequence UC040 already specifies.
2. A **GitHub Action** using that library to push the same application definitions to Entra from
   CI (the "push IaC to a tenant" workflow).
3. **Integrating that same library into the VS Code extension**, so a user can deploy from within
   the tree (a v2 capability — v1 is explicitly read-only).

This doc analyzes what each involves and whether they belong in this repo or split out.

## What each piece requires

### 1. Precompile/deployment library

- **Nunjucks rendering in Node.** UC040's format commits to Jinja2-compatible syntax, rendered via
  [Nunjucks](https://mozilla.github.io/nunjucks/) — the realistic Node option, since Jinja2 itself
  is Python. This choice is already reflected in UC040/`FunctionalRequirements.md`; what's still
  undecided here is only *where* the rendering code itself lives (this doc's subject), not which
  library it uses.
- **Per-environment render loop**: merge `Variables` with one `Environments` entry, render all
  three `.j2` files, once per environment (UC040 "Rendering ... uses a Nunjucks context ...").
- **Sequencing + cross-step placeholder resolution**: `Application.yaml.j2` must deploy first;
  its returned `appId`/object ID then feeds `ServicePrincipal.yaml.j2` and
  `FederatedCredentials.yaml.j2` (UC040, `ServicePrincipal.yaml.j2` section). This is an ordered
  deploy plan with runtime values flowing between steps, not pure templating.
- **Cross-application sequencing via `Dependencies`**: `AppConfig.yaml`'s `Dependencies` map
  (UC040) names other application definitions this one needs deployed first, for the same
  environment, resolved from a template as `{{ dependency_refs.<key>.applicationId }}` — the same
  kind of ordered, runtime-value-flowing dependency as the intra-application one above, but across
  application folders rather than within one. This is a second, compounding instance of the
  sequencing problem this library needs to solve: it must build a deploy plan across *all* selected
  applications, not just within one, detect a dependency cycle (UC040 flags this as unresolved),
  and decide what "select applications to deploy" even means when a selected application's
  dependency wasn't itself selected.
- **Idempotency/diffing**: CI would run this on every merge, so the library needs to detect
  existing objects (by `appId` once known, or a naming convention before that) and decide
  create-vs-patch rather than blindly re-`POST`ing.
- **Partial-failure semantics**: defined, testable behavior for e.g. Application succeeding but
  ServicePrincipal failing.
- **A Graph client decoupled from `vscode.SecretStorage`** — the library must accept a
  token/credential from whichever host is running it (the extension's MSAL flows, or an Action's
  OIDC/client-secret credential), not assume VS Code exists.

### 2. GitHub Action

- Thin wrapper: read `entra/Applications/*`, call the library, surface results as step
  output/annotations.
- Given this pushes to a live tenant, it realistically wants a **plan/apply split** (dry-run diff
  on PR, apply on merge) — otherwise every PR silently mutates production Entra state, a bigger
  blast radius than anything v1 does today. (`CLAUDE.md` already keeps Conditional Access out of
  scope for lockout risk; app-registration mistakes — redirect URIs, exposed secrets,
  admin-consented permissions — are lower-lockout-risk but not low-risk.)
- Needs its own credential path: GitHub Secrets → client secret/certificate, or OIDC federation
  (federated credentials are literally what UC040's `FederatedCredentials.yaml.j2` example
  targets — `token.actions.githubusercontent.com`) — independent of the extension's
  connection/SecretStorage model.
- Distribution: a JS/TS Action typically ships a committed `dist/` bundle (via `@vercel/ncc` or
  esbuild) that consumers reference with `uses: org/repo/path@ref` — a second, independent
  build/release pipeline from the extension's `esbuild.js` → `dist/extension.js`.

### 3. Integrating into the extension

- Crosses the v1 read-only boundary `CLAUDE.md` states explicitly — a real scope change (v2),
  not a drop-in.
- UI: a "Deploy" command on an Applications node, progress reporting, and — given the risk — a
  pre-deploy diff. The codebase already has a pattern for this (the shared artifact-viewer's use
  of VS Code's native diff editor for remote-vs-local comparisons).
- Reuses the same library, but supplies auth from an existing **connection** (delegated or
  app-only) rather than CI secrets — so the library's credential interface needs to cleanly
  abstract "however the host hands me a token," not assume either MSAL-in-extension or GitHub
  OIDC specifically.

## Monorepo (this repo) vs. separate repos

### Case for keeping it all here

- UC040's format is still evolving (it lists two explicitly deferred open questions and no
  tooling exists yet). While the format is unstable, one repo lets the library, its two
  consumers, and the `Requirements/` docs change atomically in one PR — no version-skew window
  where the Action understands a template shape the extension doesn't yet, or vice versa.
- This project's hard rule that `Requirements/` stays in sync with code *in the same piece of
  work* is far easier to enforce with one repo and one PR review.
- Solo/early-stage project (single commit so far as of this writing) — three repos means three
  CI setups, release processes, and issue trackers to maintain for no immediate payoff.

### Case against — and it's a real one

- **Blast-radius mismatch.** The Action runs with *write* credentials against other people's
  production tenants, in *their* CI pipelines. Bundling it with the extension means every Action
  consumer implicitly trusts the entire history and contributor set of a repo whose other half is
  a read-only VS Code extension — a much bigger supply-chain surface than the Action alone needs.
- **Versioning mismatch.** Action consumers pin `uses: org/repo@v1` and want strict semver
  stability (it's touching production); the extension wants to iterate fast and publish to the
  Marketplace on its own cadence. One repo means one tag namespace to keep straight, and a
  temptation to bump one while accidentally affecting the other.
- **Packaging mismatch.** The extension is bundled for the VS Code extension host via esbuild;
  the Action needs its own Node bundle (ncc/esbuild) with a committed `dist/`. Even living in one
  repo, this really wants npm-workspaces-style package boundaries (`packages/deploy-lib`,
  `packages/vscode-extension`, `packages/github-action`) rather than more folders under `src/` —
  otherwise the two bundlers fight over what belongs in each output.
- Coverage thresholds (`vitest.config.mts`, per `NonFunctionalRequirements.md`) and CI would need
  path-based scoping so an Action-only change doesn't force re-testing/re-bundling the extension
  and vice versa.

## Recommendation

Build the library in *this* repo as its own workspace package while the format is still churning
— UC040 has unresolved questions and no tooling yet, so a separate repo now just adds
coordination overhead for a moving target. Treat "extract the library and the Action into their
own repo(s), published as a normal versioned package" as the trigger point once the format
stabilizes and there are real production users of the Action — the credential/blast-radius
mismatch is the one issue that gets harder to unwind the longer it's deferred; everything else
(CI scoping, workspace layout) is cheap to fix later.

## Related

- [UC040 — Define an Application](../Requirements/UseCases/UC400_ApplicationManagement/UC040_DefineApplication.md) —
  the format this tooling would operate on, including its own open questions.
- [UC041 — Browse Application Definitions](../Requirements/UseCases/UC400_ApplicationManagement/UC041_BrowseApplicationDefinitions.md) —
  the only implemented piece of UC400 today.
- `CLAUDE.md` — states the v1 read-only scope this proposal would extend, and the "keep
  Requirements/ in sync with code" rule this doc's recommendation leans on.
