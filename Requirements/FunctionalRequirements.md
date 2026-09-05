# Overview

This page documents the functional requirements of the solution.

## Description

This solution is intended to provide a design-time VS Code extension to manage Entra External Id an Entra Workforce artifacts as Infratrsucture as Code.

It will support deploying the same artifacts to multiple logical environments.

Initialy it will implement a read-only workflow: authenticating interactively to an Entra tenant, browsing the artifacts deployed there via Microsoft Graph, and downloading them into a local, version-controllable project structure. Writing/deploying local artifacts back to a tenant is out of scope for this initial version and will follow in a later phase.

Reaching a tenant starts with a **connection**: a saved, named record of how to reach it (tenant ID, cloud, optional client ID), created via an explicit "Add Connection" step and reused every time the user authenticates. Connections are the v1 building block; the multi-environment deployment model above will build on named connections once write-back is in scope.

The initial artifact types supported are:

* App registrations and their associated service principals
* Groups and directory roles
* Entra External ID (CIAM) user flows and custom authentication extensions

Conditional Access policies are explicitly out of scope for the initial version, as an incorrect change carries a high risk of locking administrators out of a tenant.