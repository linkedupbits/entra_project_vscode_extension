import { Cloud } from '../connections/types';

/**
 * Microsoft Graph hostnames per sovereign cloud — the single source of truth shared by
 * AuthService (which appends `/.default` to build the token audience/scope) and graphClient.ts
 * (which appends `/v1.0/...` to build REST URLs), so these three hostnames are never duplicated.
 */
export const GRAPH_HOST: Record<Cloud, string> = {
  public: 'graph.microsoft.com',
  usGov: 'graph.microsoft.us',
  china: 'microsoftgraph.chinacloudapi.cn',
};
