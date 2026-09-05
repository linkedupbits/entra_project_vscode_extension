#!/usr/bin/env node
/**
 * Reusable development tool — NOT part of the shipped extension. Regenerates
 * `src/graph/wellKnownPermissions/microsoftGraph.json`, the lookup table
 * `src/graph/wellKnownPermissions.ts` uses to turn a `RequiredPermission`'s opaque
 * (resourceAppId, id) pair into a human-readable name (e.g. "Directory.Read.All") when previewing
 * an application's required permissions (see UC034's structured preview).
 *
 * Two modes:
 *
 * 1. Default — no credentials needed. Fetches Microsoft's own public, unauthenticated permissions
 *    catalogue (the same data that powers https://learn.microsoft.com/graph/permissions-reference):
 *
 *      https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/master/permissions/permissions-descriptions.json
 *
 *    This is a static file on a community/devx-tooling repo, not a documented, versioned public
 *    API with an SLA — its path could move without notice — but it's maintained by Microsoft and
 *    verified (as of writing) to carry the exact same `id`/`value` pairs Graph itself returns.
 *    `applicationScopesList` entries become `type: 'Role'` (application permissions);
 *    `delegatedScopesList` entries become `type: 'Scope'` (delegated permissions).
 *
 * 2. `--from-tenant` — the original approach, querying a real tenant's live Microsoft Graph
 *    service principal directly (authoritative, but needs credentials):
 *
 *      GET /v1.0/servicePrincipals?$filter=appId eq '00000003-0000-0000-c000-000000000000'
 *          &$select=appRoles,oauth2PermissionScopes
 *
 * Usage:
 *   node scripts/downloadGraphPermissions.js
 *   npm run download:graph-permissions
 *
 *   node scripts/downloadGraphPermissions.js --from-tenant --client-id <app-registration-client-id> [options]
 *   npm run download:graph-permissions -- --from-tenant --client-id <app-registration-client-id>
 *
 * `--from-tenant` options:
 *   --client-id <id>   Required. An application (client) ID you control or trust — the same
 *                       requirement `entra.clientId` states for the extension itself (see
 *                       README.md). No default is provided deliberately.
 *   --tenant-id <id>   Authority tenant segment (default: "organizations" — any work/school
 *                       account can sign in, since Graph's own permission catalogue is the same
 *                       in every tenant).
 *   --cloud <cloud>    "public" (default), "usGov", or "china".
 *
 * `--from-tenant` signs in via MSAL's device code flow (prints a URL + code to sign in with any
 * browser) — reading another service principal's `appRoles`/`oauth2PermissionScopes` needs at
 * least the delegated `Application.Read.All` permission (or `Directory.Read.All`), so the
 * signed-in account/app registration needs that permission granted and consented.
 */

const fs = require('fs');
const path = require('path');

const MICROSOFT_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const PUBLIC_PERMISSIONS_URL =
  'https://raw.githubusercontent.com/microsoftgraph/microsoft-graph-devx-content/master/permissions/permissions-descriptions.json';

const CLOUD_AUTHORITY_HOST = {
  public: 'login.microsoftonline.com',
  usGov: 'login.microsoftonline.us',
  china: 'login.partner.microsoftonline.cn',
};

const GRAPH_HOST = {
  public: 'graph.microsoft.com',
  usGov: 'graph.microsoft.us',
  china: 'microsoftgraph.chinacloudapi.cn',
};

const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'graph', 'wellKnownPermissions', 'microsoftGraph.json');

function parseArgs(argv) {
  const args = { tenantId: 'organizations', cloud: 'public', fromTenant: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--from-tenant') {
      args.fromTenant = true;
    } else if (arg === '--client-id') {
      args.clientId = argv[++i];
    } else if (arg === '--tenant-id') {
      args.tenantId = argv[++i];
    } else if (arg === '--cloud') {
      args.cloud = argv[++i];
    }
  }
  return args;
}

/** Mode 1 (default) — Microsoft's own public, unauthenticated permissions catalogue. */
async function fetchFromPublicCatalogue() {
  const response = await fetch(PUBLIC_PERMISSIONS_URL);
  if (!response.ok) {
    throw new Error(`Fetching ${PUBLIC_PERMISSIONS_URL} returned ${response.status} ${response.statusText}.`);
  }
  const catalogue = await response.json();

  const permissions = {};
  for (const entry of catalogue.applicationScopesList || []) {
    permissions[entry.id] = { name: entry.value, type: 'Role' };
  }
  for (const entry of catalogue.delegatedScopesList || []) {
    permissions[entry.id] = { name: entry.value, type: 'Scope' };
  }
  return {
    permissions,
    roleCount: (catalogue.applicationScopesList || []).length,
    scopeCount: (catalogue.delegatedScopesList || []).length,
  };
}

/** Mode 2 (--from-tenant) — the original live-Graph, credentialed approach. */
async function acquireAccessToken(clientId, tenantId, cloud) {
  const msal = require('@azure/msal-node');
  const authority = `https://${CLOUD_AUTHORITY_HOST[cloud]}/${tenantId}`;
  const client = new msal.PublicClientApplication({ auth: { clientId, authority } });
  const result = await client.acquireTokenByDeviceCode({
    scopes: [`https://${GRAPH_HOST[cloud]}/.default`],
    deviceCodeCallback: (response) => {
      console.log(`\nSign in to continue: open ${response.verificationUri} and enter code ${response.userCode}\n`);
    },
  });
  if (!result || !result.accessToken) {
    throw new Error('Sign-in did not complete.');
  }
  return result.accessToken;
}

async function fetchFromTenant(clientId, tenantId, cloud) {
  const accessToken = await acquireAccessToken(clientId, tenantId, cloud);
  const filter = encodeURIComponent(`appId eq '${MICROSOFT_GRAPH_APP_ID}'`);
  const url = `https://${GRAPH_HOST[cloud]}/v1.0/servicePrincipals?$filter=${filter}&$select=appRoles,oauth2PermissionScopes`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Microsoft Graph returned ${response.status} ${response.statusText}${body ? `: ${body}` : '.'}`);
  }
  const page = await response.json();
  const servicePrincipal = page.value && page.value[0];
  if (!servicePrincipal) {
    throw new Error("Microsoft Graph's own service principal was not found in this tenant — is it accessible?");
  }

  const permissions = {};
  for (const role of servicePrincipal.appRoles || []) {
    permissions[role.id] = { name: role.value, type: 'Role' };
  }
  for (const scope of servicePrincipal.oauth2PermissionScopes || []) {
    permissions[scope.id] = { name: scope.value, type: 'Scope' };
  }
  return {
    permissions,
    roleCount: (servicePrincipal.appRoles || []).length,
    scopeCount: (servicePrincipal.oauth2PermissionScopes || []).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.fromTenant && !args.clientId) {
    console.error(
      'Usage: node scripts/downloadGraphPermissions.js --from-tenant --client-id <app-registration-client-id> [--tenant-id <id>] [--cloud public|usGov|china]'
    );
    process.exit(1);
  }
  if (!CLOUD_AUTHORITY_HOST[args.cloud]) {
    console.error(`Unknown --cloud "${args.cloud}" — expected one of: ${Object.keys(CLOUD_AUTHORITY_HOST).join(', ')}`);
    process.exit(1);
  }

  const { permissions, roleCount, scopeCount } = args.fromTenant
    ? await fetchFromTenant(args.clientId, args.tenantId, args.cloud)
    : await fetchFromPublicCatalogue();

  const sortedPermissions = Object.fromEntries(
    Object.entries(permissions).sort(([, a], [, b]) => a.name.localeCompare(b.name))
  );

  const output = {
    resourceAppId: MICROSOFT_GRAPH_APP_ID,
    displayName: 'Microsoft Graph',
    source: args.fromTenant ? 'tenant' : 'public-catalogue',
    generatedAt: new Date().toISOString(),
    permissions: sortedPermissions,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(
    `Wrote ${Object.keys(sortedPermissions).length} permissions (${roleCount} application, ${scopeCount} delegated) to ${path.relative(process.cwd(), OUTPUT_FILE)}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
