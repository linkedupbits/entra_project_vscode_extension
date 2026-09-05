# UC040 — Define an Application

## Overview

This use case specifies the local file structure and format for an **application definition** — a locally-authored, deployable unit bundling the three Entra objects that make up one logical application (App Registration, Service Principal, Federated Credentials), parameterised with Jinja templating so it can later be rendered and deployed to more than one tenant/environment.

This is deliberately a **data-format specification**, not itself an interactive workflow: it defines what a valid application definition looks like on disk so the convention is stable. It is the local counterpart to a downloaded artifact (see [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)), but runs in the opposite direction: UC020 mirrors a Graph object *into* a read-only-ish local snapshot; this use case mirrors a *locally-authored* definition *into* the Graph JSON shape needed to create or update that object, once deploy tooling exists to do so. Browsing what's already defined and editing an existing one's files through a structured view are both implemented — see [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md) and [UC042 — View Application Details](UC042_ViewApplicationDetails.md). Creating a *new* application definition from scratch, rendering its Jinja templates, and deploying the result to a tenant are not.

## Actors

* **User** — authors and hand-maintains an application definition.
* **Extension** — validates/renders the definition (in later phases; this use case fixes the format it will operate on).

## Preconditions

* The workspace has an artifacts root folder (`entra/` by default, configurable via `entra.artifactsRootFolder`).

## Structure

One application is one folder, named for the application, directly under `<root>/applications/`:

```
entra/
  applications/
    <application-name>/
      AppConfig.yaml
      Application.yaml.j2
      FederatedCredentials.yaml.j2
      ServicePrincipal.yaml.j2
```

`<application-name>` is a human-chosen, filesystem-safe logical name — not a Graph ID, since an application definition can (and typically does, for a new application) exist before anything has been deployed and therefore before any Graph object ID exists.

### `AppConfig.yaml`

Not a Graph object mirror, and not itself Jinja-templated — but it is the source of the values the other three files' Jinja placeholders resolve to, one full render per listed environment. Shape:

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
  - name: Test
    publisherDomain: contoso-test.onmicrosoft.com
    tenancy_type: ciam
    environment_code: test
```

* `application_name` / `business_unit` — plain, application-wide metadata (not per environment).
* `Variables` — default values shared across every environment. Anchored (`&DefaultVariables`) so a specific environment entry can splice it in (`<<: *DefaultVariables`) alongside its own overrides, rather than repeating shared values in every environment.
* `Environments` — a list of deployment targets. `name`, `publisherDomain`, `tenancy_type`, and `environment_code` are the fixed fields every entry carries; an entry may add further keys a specific template needs. `tenancy_type` (`ciam` in the example) is this file's own concept — it is not read from, or written back to, a saved [connection](../UC100_Security/UC012_AddConnection.md)'s `tenantKind`; the two happen to draw the same Workforce/CIAM distinction but are otherwise independent until a later phase decides whether/how to unify them.

Rendering `Application.yaml.j2`, `FederatedCredentials.yaml.j2`, and `ServicePrincipal.yaml.j2` for one environment uses a Jinja context built from `Variables` merged with that environment's own entry — the environment's own fields win if a key appears in both. This happens once per entry in `Environments`, so one application definition with two environments listed renders (and, once deploy tooling exists, deploys) twice, independently.

### `Application.yaml.j2`

Models the Entra App Registration. Structured to mirror the JSON body `POST /applications` (create) or `PATCH /applications/{id}` (update) expects — same field names, same nesting — so it can be rendered and submitted with minimal transformation, not remapped through a bespoke schema. Jinja placeholders substitute the values that vary per deployment target (e.g. a redirect URI, a display-name suffix identifying the environment):

```yaml
displayName: "{{ application_name }} ({{ name }})"
signInAudience: AzureADMyOrg
web:
  redirectUris:
    - "https://{{ environment_code }}.example.com/signin-oidc"
requiredResourceAccess:
  - resourceAppId: "00000003-0000-0000-c000-000000000000" # Microsoft Graph
    resourceAccess:
      - id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d" # User.Read
        type: Scope
```

(`application_name` comes from `AppConfig.yaml`'s application-wide metadata; `name` and `environment_code` from whichever `Environments` entry is being rendered.)

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
tags:
  - "WindowsAzureActiveDirectoryIntegratedApp"
```

Note the `appId` field's value: a Service Principal is created *from* an Application's `appId` (its client ID), which for a brand-new application does not exist until `Application.yaml.j2` has actually been deployed and Graph has returned one. `ServicePrincipal.yaml.j2` and `FederatedCredentials.yaml.j2` (which similarly needs the Application's object ID as its parent resource) are therefore dependent on `Application.yaml.j2` having been deployed first, *for the same environment* — deploy tooling will need to sequence these three files per environment, not treat them as independent, and resolve a placeholder like `{{ application.appId }}` from that prior deploy step's result rather than from `AppConfig.yaml` like the other placeholders in this use case.

## Resolved

* **Where do Jinja placeholder values come from?** From `AppConfig.yaml` itself — see above. `Variables` supplies defaults shared across all environments; each `Environments` entry supplies (and can override) values specific to one deployment target. This was an open question in an earlier draft of this use case; it no longer is.

## Open questions (explicitly deferred, not decided by this use case)

* **How does an application definition relate to a downloaded artifact?** Whether downloading an existing App Registration (UC031) should ever populate — or offer to seed — an application definition, rather than only the flat `appRegistrations/` snapshot, is unresolved. Until decided, the two representations are independent: downloading does not create or update an application definition, and deploying an application definition (once that exists) is not assumed to update the flat downloaded-snapshot files.
* **Should `tenancy_type` unify with a connection's `tenantKind`?** Both distinguish Workforce from CIAM tenants but are currently separate concepts (see the `AppConfig.yaml` section above) — not decided either way.
* **How is a *new* application definition created, and how are its templates rendered/deployed?** No command or UI for either is specified by this use case — only the on-disk format. [UC042](UC042_ViewApplicationDetails.md) covers editing an *existing* application's files, not creating one from scratch (e.g. an `entra.addApplication` command) or resolving its Jinja placeholders against a target environment; both remain expected in a later phase.

## Postconditions

* A folder under `<root>/applications/` containing the four files above constitutes a valid application definition, whether created by hand or (in a later phase) by tooling.
* No network call, authentication, or Graph interaction happens as a result of this use case alone — defining an application is entirely local.

## Related

* [UC020 — Serialize Artifact to Project File](../UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md) — the read-only counterpart this use case is explicitly distinct from.
* [UC012 — Add Connection](../UC100_Security/UC012_AddConnection.md) — a separate per-environment concept (`tenantKind`) that `AppConfig.yaml`'s `tenancy_type` parallels without (yet) being unified with — see the open questions above.
* [UC041 — Browse Application Definitions](UC041_BrowseApplicationDefinitions.md) — the implemented read/browse use of this format.
* [UC042 — View Application Details](UC042_ViewApplicationDetails.md) — the implemented structured editor for an existing application's files, and the source of the documented comment/anchor/extra-field loss on save.
