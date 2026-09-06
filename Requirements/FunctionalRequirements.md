# Overview

This page documents the functional requirements of the solution.

## Description

This solution is intended to provide a design-time VS Code extension to manage Entra External Id an Entra Workforce artifacts as Infratrsucture as Code.

It will support deploying the same artifacts to multiple logical environments.

Initialy it will implement a read-only workflow: authenticating interactively to an Entra tenant, browsing the artifacts deployed there via Microsoft Graph, and downloading them into a local, version-controllable project structure. Writing/deploying local artifacts back to a tenant is out of scope for this initial version and will follow in a later phase.

Reaching a tenant starts with a **connection**: a saved, named record of how to reach it (tenant ID, cloud, optional client ID), created via an explicit "Add Connection" step and reused every time the user authenticates. Connections are the v1 building block; the multi-environment deployment model above will build on named connections once write-back is in scope.

When browsing a connected tenant's applications, they are grouped in the tree by logical environment — one grouping node per distinct `Environment:<name>` tag found on an application's Service Principal (the same deploy-time tagging convention application definitions use), so applications belonging to the same environment are shown together. See [UC030](UseCases/UC300_ArtifactBrowsing/UC030_BrowseTenantArtifacts.md).

The initial artifact types supported are:

* App registrations and their associated service principals
* Groups and directory roles
* Entra External ID (CIAM) user flows and custom authentication extensions

Conditional Access policies are explicitly out of scope for the initial version, as an incorrect change carries a high risk of locking administrators out of a tenant.

## Application definitions

Distinct from the read-only downloaded-artifact snapshots above (a flat, per-object-type mirror of what's already in a tenant — see [UC020](UseCases/UC200_ArtifactSerialisation/UC020_SerializeArtifactToProjectFile.md)), the project structure also supports **application definitions**: a locally-authored, deployable unit that bundles the three Entra objects that make up one logical application — its App Registration, the Enterprise Application (Service Principal) associated with it, and its Federated Credentials — grouped together and parameterised with [Nunjucks](https://mozilla.github.io/nunjucks/) templating — a Jinja2-compatible engine for Node, chosen because Jinja2 itself is Python — so the same definition can be rendered and deployed to multiple logical environments/tenants, per the multi-environment goal above.

This is a data-format requirement, specified now so the convention is stable; it is not itself a deploy feature. Actually rendering these templates and submitting the result to Microsoft Graph (the write-back capability referenced above) remains a later phase — see [UC040 — Define an Application](UseCases/UC400_ApplicationManagement/UC040_DefineApplication.md) for the full structure and its remaining open questions.

Each application is a folder of four files:

* `AppConfig.yaml` — not a Graph object mirror, and not itself templated, but the source of the values the other three files' Nunjucks placeholders resolve to: application-wide metadata, a set of default variables shared across environments, a list of named target environments (each supplying the values specific to that one deployment target — e.g. its tenant, its Workforce/CIAM type), and a map of dependencies on other application definitions in the project, used for deploy-time sequencing and referenced from a template as `{{ dependency_refs.<key>.applicationId }}`. When an application is downloaded from a tenant (UC035), this dependency map is populated automatically from the application's required permissions — every resource it requests permissions from, other than Microsoft Graph, becomes a dependency. One application definition with several environments listed here renders and deploys once per environment.
* `Application.yaml.j2` — a Nunjucks-templated YAML document modelling the Entra App Registration, structured to mirror the Microsoft Graph JSON body used to create/update it.
* `FederatedCredentials.yaml.j2` — a Nunjucks-templated YAML document modelling the application's federated identity credentials, structured to mirror the Microsoft Graph JSON body used to create each one.
* `ServicePrincipal.yaml.j2` — a Nunjucks-templated YAML document modelling the Enterprise Application (Service Principal) associated with the App Registration, structured to mirror the Microsoft Graph JSON body used to create/update it.