# UC040 — Define an Application

## Overview

This use case specifies the local file structure and format for an **application definition** — a locally-authored, deployable unit bundling the three Entra objects that make up one logical application (App Registration, Service Principal, Federated Credentials), parameterised with [Nunjucks](https://mozilla.github.io/nunjucks/) templating — a Jinja2-compatible engine for Node, chosen because Jinja2 itself is Python — so it can later be rendered and deployed to more than one tenant/environment.

This is deliberately a **data-format specification**, not itself an interactive workflow: it defines what a valid application definition looks like on disk so the convention is stable. It is the local counterpart to a downloaded artifact (see [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)), but runs in the opposite direction: UC020 mirrors a Graph object *into* a read-only-ish local snapshot; this use case mirrors a *locally-authored* definition *into* the Graph JSON shape needed to create or update that object, once deploy tooling exists to do so. Browsing what's already defined, editing an existing one's files through a structured view, and creating/deleting a definition from the tree are all implemented — see [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md), [UC042 — View Application Details](UC042_ViewApplicationDetails.md), and [UC043 — Create and Delete an Application Definition](UC043_CreateAndDeleteApplicationDefinition.md). Rendering a definition's Nunjucks templates and deploying the result to a tenant are not.

## Actors

* **User** — authors and hand-maintains an application definition.
* **Extension** — validates/renders the definition (in later phases; this use case fixes the format it will operate on).

## Preconditions

* The workspace has an artifacts root folder (`entra/` by default, configurable via `entra.artifactsRootFolder`).

## Structure

One application is one folder, named for the application, directly under `<root>/Applications/`:

```
entra/
  Applications/
    <application-name>/
      AppConfig.yaml
      Application.yaml.j2
      FederatedCredentials.yaml.j2
      ServicePrincipal.yaml.j2
```

`<application-name>` is a human-chosen, filesystem-safe logical name — not a Graph ID, since an application definition can (and typically does, for a new application) exist before anything has been deployed and therefore before any Graph object ID exists.

### `AppConfig.yaml`

Not a Graph object mirror, and not itself Nunjucks-templated — but it is the source of the values the other three files' Nunjucks placeholders resolve to, one full render per listed environment. Shape:

```yaml
application_name: my-application
business_unit: My Business Unit

Variables: &DefaultVariables
  something: AValue

Environments:
  - name: Dev
    publisherDomain: contoso-dev.onmicrosoft.com
    tenancy_type: ciam
    environment_code: dev
    Variables:
      <<: *DefaultVariables
      MyNewPermissionVariableName: 3fa85f64-5717-4562-b3fc-2c963f66afa6
  - name: Test
    publisherDomain: contoso-test.onmicrosoft.com
    tenancy_type: ciam
    environment_code: test
    Variables:
      <<: *DefaultVariables
      MyNewPermissionVariableName: 6ba7b810-9dad-11d1-80b4-00c04fd430c8

Dependencies:
  SampleAPIApp:
    AppName: sample-api
```

* `application_name` / `business_unit` — plain, application-wide metadata (not per environment).
* `Variables` — default values shared across every environment. Anchored (`&DefaultVariables`) so a specific environment entry can splice it in (`<<: *DefaultVariables`) alongside its own overrides, rather than repeating shared values in every environment.
* `Environments` — a list of deployment targets. `name`, `publisherDomain`, `tenancy_type`, and `environment_code` are the fixed fields every entry carries; an entry may add further keys a specific template needs. `tenancy_type` (`ciam` in the example) is this file's own concept — it is not read from, or written back to, a saved [connection](../UC100_Security/UC012_AddConnection.md)'s `tenantKind`; the two happen to draw the same Workforce/CIAM distinction but are otherwise independent until a later phase decides whether/how to unify them. Each entry also carries its own `Variables` map, distinct from the top-level one above — this is where a value that must be a fixed, real one *per environment* lives (e.g. `MyNewPermissionVariableName` above, an `Application.yaml.j2` `oauth2PermissionScopes` entry's `id` — see below), referenced from a template as `{{ environment.Variables.<key> }}`. [UC042](UC042_ViewApplicationDetails.md)'s editor keeps every environment's `Variables` map populated with the shared defaults (achieving the same effect as the `<<: *DefaultVariables` merge key shown above, without preserving that literal syntax — see UC042's Postconditions) plus a freshly generated GUID for any such per-environment key it introduces that's not already present.
* `Dependencies` — a map of other application definitions this one depends on for deploy-time sequencing. Each entry's key (`SampleAPIApp` above) is a reference name chosen by the author, used from a template as `{{ dependency_refs.SampleAPIApp.applicationId }}` (see below); its `AppName` value is the referenced application's folder name under `<root>/Applications/` — the same folder [UC042](UC042_ViewApplicationDetails.md)'s form picks from a list of the project's existing applications, not free text, so a dependency can't point at an application that doesn't exist in the project. This only records the dependency and its sequencing implication; it does not itself resolve `applicationId` — that happens once deploy tooling exists (see Open questions), from the referenced application's own prior deploy result for the same environment.

Rendering `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and `ServicePrincipal.yaml.j2` for one environment uses a Nunjucks context built from `Variables` merged with that environment's own entry — the environment's own fields win if a key appears in both — plus a `dependency_refs` object with one key per entry in `Dependencies`, each resolved (once deploy tooling exists) to that referenced application's own deploy result for the same environment. This happens once per entry in `Environments`, so one application definition with two environments listed renders (and, once deploy tooling exists, deploys) twice, independently, each render needing its dependencies deployed for that same environment first.

### `Application.yaml.j2`

Models the Entra App Registration. Structured to mirror the JSON body `POST /applications` (create) or `PATCH /applications/{id}` (update) expects — same field names, same nesting — so it can be rendered and submitted with minimal transformation, not remapped through a bespoke schema. Nunjucks placeholders substitute the values that vary per deployment target (e.g. a redirect URI, a display-name suffix identifying the environment):

```yaml
displayName: "{{ application_name }} ({{ name }})"
signInAudience: AzureADMyOrg
web:
  redirectUris: [{% for item in (environment.Variables.web_redirectUris | default([])) %}"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]
  redirectUriSettings: [{% for item in (environment.Variables.web_redirectUris | default([])) %}{"uri": "{{ item }}", "index": null}{% if not loop.last %}, {% endif %}{% endfor %}]
publicClient:
  redirectUris: [{% for item in (environment.Variables.publicClient_redirectURIs | default([])) %}"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]
spa:
  redirectUris: [{% for item in (environment.Variables.spa_redirectURIs | default([])) %}"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]
requiredResourceAccess:
  - resourceAppId: "00000003-0000-0000-c000-000000000000" # Microsoft Graph
    resourceAccess:
      - id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d" # User.Read
        type: Scope
api:
  oauth2PermissionScopes:
    - id: "{{ environment.Variables.MyNewPermissionVariableName }}"
      adminConsentDescription: "Allows the app to access my-application on behalf of the signed-in user."
      adminConsentDisplayName: "Access my-application"
      isEnabled: true
      type: User
      userConsentDescription: "Allows the app to access my-application on your behalf."
      userConsentDisplayName: "Access my-application"
      value: access_as_user
```

(`application_name` comes from `AppConfig.yaml`'s application-wide metadata; `name` and `environment_code` from whichever `Environments` entry is being rendered.)

Redirect URIs are defined **per environment**, not once on the App Registration — they can legitimately differ between deployment targets. Each `Environments` entry's own `Variables` map carries three array-valued keys — `web_redirectUris`, `publicClient_redirectURIs`, `spa_redirectURIs` (the mixed `Uris`/`URIs` casing is intentional) — which the template above pulls into the matching Graph `web`/`publicClient`/`spa` blocks. [UC042](UC042_ViewApplicationDetails.md)'s structured editor manages these as three dedicated redirect-URI lists inside each environment card.

Each of those redirect values is written as a `{% for %}` loop that emits literal array syntax (`["a", "b"]`, or `[]` when the environment's list is empty) — the same portable Jinja2/Nunjucks form, and for the same reason, as `ServicePrincipal.yaml.j2`'s `replyUrls` (see below). `web.redirectUriSettings` uses the same `web_redirectUris` list but renders Graph's object shape instead — an array of `{ "uri": <redirect uri>, "index": null }` (the `index` is always `null`; Graph assigns real indexes). Consequently those four lines are **not valid YAML until rendered**; UC042's editor strips them (and re-generates them on save) exactly as it does for `replyUrls`.

`requiredResourceAccess` is what this application *requests* from other resources; `api.oauth2PermissionScopes` is the reverse — delegated permission scopes this application itself *exposes* for other applications to request. Each entry mirrors Graph's `permissionScope` type exactly, one entry per scope. `id` is a GUID Graph uses to match a scope across updates — [UC042](UC042_ViewApplicationDetails.md)'s editor generates one automatically, or (as above) writes it as `{{ environment.Variables.<key> }}` so the real value lives per environment in `AppConfig.yaml` instead of being fixed once at authoring time (see that file's `Environments` bullet above).

### `FederatedCredentials.yaml.j2`

Models the application's federated identity credentials (e.g. for workload identity federation with a CI/CD system). An application can have zero or more, so this file is a YAML list; each list item mirrors the JSON body `POST /applications/{id}/federatedIdentityCredentials` expects for one credential — deploying this file means one such request per list item, not one request for the whole list:

```yaml
- name: "{{ environment_code }}-deploy"
  issuer: "https://token.actions.githubusercontent.com"
  subject: "repo:my-org/my-repo:environment:{{ environment_code }}"
  audiences:
    - "api://AzureADTokenExchange"
  description: "OIDC federation for CI/CD deployments from the {{ name }} environment."
```

### `ServicePrincipal.yaml.j2`

Models the Enterprise Application (Service Principal) associated with the App Registration. Structured to mirror the JSON body `POST /servicePrincipals` (create) or `PATCH /servicePrincipals/{id}` (update) expects:

```yaml
appId: "{{ application.appId }}"
appRoleAssignmentRequired: true
replyUrls: [{% for item in (environment.Variables.web_redirectUris | default([])) + (environment.Variables.publicClient_redirectURIs | default([])) + (environment.Variables.spa_redirectURIs | default([])) %}"{{ item }}"{% if not loop.last %}, {% endif %}{% endfor %}]
tags:
  - "WindowsAzureActiveDirectoryIntegratedApp"
```

`replyUrls` is the Service-Principal-level equivalent of the App Registration's per-category redirect URIs: it renders to the concatenation of the current environment's three redirect-URI variable lists (see the Redirect URIs note under `Application.yaml.j2` above), each `| default([])` so a category the environment doesn't define contributes nothing. It's written as a `{% for %}` loop that emits literal array syntax (`["a", "b"]`, or `[]` when all three lists are empty) — deliberately, so the *rendered* file contains a real YAML array rather than an engine-specific stringification of a list; every construct in it (`for` / `loop.last` / `if` / `+` / `default`) is common to Jinja2 and Nunjucks. Consequently **that line is not valid YAML until rendered** — like `Application.yaml.j2`'s four redirect-block lines above, it's handled by [UC042](UC042_ViewApplicationDetails.md)'s editor stripping the generated line before it parses the file and re-adding it on save (it is generated, not editable). These generated redirect lines are the only parts of the four files that aren't plain valid YAML.

Note the `appId` field's value: a Service Principal is created *from* an Application's `appId` (its client ID), which for a brand-new application does not exist until `Application.yaml.j2` has actually been deployed and Graph has returned one. `ServicePrincipal.yaml.j2` and `FederatedCredentials.yaml.j2` (which similarly needs the Application's object ID as its parent resource) are therefore dependent on `Application.yaml.j2` having been deployed first, *for the same environment* — deploy tooling will need to sequence these three files per environment, not treat them as independent, and resolve a placeholder like `{{ application.appId }}` from that prior deploy step's result rather than from `AppConfig.yaml` like the other placeholders in this use case.

## Resolved

* **Where do Nunjucks placeholder values come from?** From `AppConfig.yaml` itself — see above. `Variables` supplies defaults shared across all environments; each `Environments` entry supplies (and can override) values specific to one deployment target; `Dependencies` supplies the `dependency_refs` object, one key per entry, resolved from each referenced application's own deploy result. This was an open question in an earlier draft of this use case; it no longer is.
* **How is a dependency on another application recorded, and can it reference an application that doesn't exist?** As a `Dependencies` map entry (`AppName` naming the other application's folder) — see above. No: [UC042](UC042_ViewApplicationDetails.md)'s form picks `AppName` from the project's existing application folders rather than accepting free text, so a dependency can't be created pointing at a nonexistent application through that form (a hand-edited file could still do so, same as any other field this format doesn't otherwise constrain).
* **How does an application definition relate to a downloaded artifact?** Resolved for Applications specifically, differently than either side of this question originally assumed: downloading a tenant application (see [UC300/UC034](../UC300_ArtifactBrowsing/UC034_PreviewApplicationArtifact.md) and [UC035](../UC300_ArtifactBrowsing/UC035_DownloadApplicationArtifact.md)) *does* seed/update an application definition folder — identified by an `AppName:` tag on the tenant's Service Principal, not by matching an existing local folder some other way — but non-destructively: it only fills in `AppConfig.yaml` fields that are currently blank, only adds an `Environments` entry the folder doesn't already have, and never overwrites an existing `.yaml.j2` template. There is still no flat `appRegistrations/`-style snapshot for Applications (UC031's original shape) — UC035 replaces that idea for this category rather than adding to it. This remains an open question for every other artifact category, which would still default to UC031's flat-snapshot model if/when implemented.
* **Should `tenancy_type` unify with a connection's `tenantKind`?** Both distinguish Workforce from CIAM tenants but are currently separate concepts (see the `AppConfig.yaml` section above) — not decided either way.
* **How is a *new* application definition created?** Resolved: [UC043](UC043_CreateAndDeleteApplicationDefinition.md)'s **New Application** action scaffolds the folder and four files at their empty defaults (and its **Delete Application** removes one), from the tree. Rendering a definition's Nunjucks placeholders against a target environment and deploying the result still remain expected in a later phase — this use case and UC043 both stop at the on-disk format.
* **How does deploy tooling actually resolve `dependency_refs`, sequence multi-level dependency chains, or detect a dependency cycle?** `Dependencies` records the relationship and this use case's Rendering section states the one-level sequencing rule (a dependency deploys first, for the same environment), but nothing yet defines the deploy algorithm itself — including what happens if application A depends on B which depends on A. Deferred to whichever later phase specifies deploy tooling (see [Architecture/future_considerations.md](../../../Architecture/future_considerations.md)).

## Postconditions

* A folder under `<root>/Applications/` containing the four files above constitutes a valid application definition, whether created by hand or (in a later phase) by tooling.
* No network call, authentication, or Graph interaction happens as a result of this use case alone — defining an application is entirely local.

## Related

* [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md) — the read-only counterpart this use case is explicitly distinct from.
* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md) — a separate per-environment concept (`tenantKind`) that `AppConfig.yaml`'s `tenancy_type` parallels without (yet) being unified with — see the open questions above.
* [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md) — the implemented read/browse use of this format.
* [UC042 — View Application Details](UC042_ViewApplicationDetails.md) — the implemented structured editor for an existing application's files, and the source of the documented comment/extra-field loss on save; the `Variables: &DefaultVariables` merge key above is specifically *not* among what's lost — see its Postconditions.
* [Architecture/future_considerations.md](../../../Architecture/future_considerations.md) — deploy-tooling design notes that would resolve `dependency_refs` and sequence dependent applications; not a decision record.
* [UC034 — Preview an Application Artifact](../UC300_ArtifactBrowsing/UC034_PreviewApplicationArtifact.md) / [UC035 — Download an Application Artifact to the Project](../UC300_ArtifactBrowsing/UC035_DownloadApplicationArtifact.md) — the implemented resolution of this use case's downloaded-artifact open question, for Applications specifically.
* [UC043 — Create and Delete an Application Definition](UC043_CreateAndDeleteApplicationDefinition.md) — the implemented resolution of this use case's "how is a new definition created?" open question (folder scaffolding only).
