import { Cloud } from '../connections/types';
import { GRAPH_HOST } from './graphHosts';

/** The subset of Graph's `application` resource this extension currently displays (UC030). */
export interface GraphApplication {
  id: string;
  appId: string;
  displayName: string;
}

interface GraphListResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeApplication(entry: unknown): GraphApplication {
  const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  return { id: asString(obj.id), appId: asString(obj.appId), displayName: asString(obj.displayName) };
}

/**
 * UC030 — lists every application (app registration) in a tenant, following `@odata.nextLink`
 * automatically until the full set has been fetched, rather than exposing manual "Load more"
 * paging to the caller (a simplification over UC030's full alternate-flow spec, which still
 * describes incremental paging for a future, very-large-tenant scenario).
 */
export async function listApplications(accessToken: string, cloud: Cloud): Promise<GraphApplication[]> {
  const applications: GraphApplication[] = [];
  let url: string | undefined = `https://${GRAPH_HOST[cloud]}/v1.0/applications?$select=id,appId,displayName`;

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Microsoft Graph returned ${response.status} ${response.statusText} listing applications` +
          (body ? `: ${body}` : '.')
      );
    }
    const page = (await response.json()) as GraphListResponse<unknown>;
    applications.push(...page.value.map(normalizeApplication));
    url = page['@odata.nextLink'];
  }

  return applications;
}
