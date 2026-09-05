import { describe, it, expect } from 'vitest';
import { getWellKnownResourceApplication, MICROSOFT_GRAPH_APP_ID } from './wellKnownPermissions';

describe('getWellKnownResourceApplication', () => {
  it('resolves Microsoft Graph, including a known application permission (Role)', () => {
    const resource = getWellKnownResourceApplication(MICROSOFT_GRAPH_APP_ID);
    expect(resource?.displayName).toBe('Microsoft Graph');
    expect(resource?.permissions['7ab1d382-f21e-4acd-a863-ba3e13f7da61']).toEqual({
      name: 'Directory.Read.All',
      type: 'Role',
    });
  });

  it('resolves a known Microsoft Graph delegated permission (Scope)', () => {
    const resource = getWellKnownResourceApplication(MICROSOFT_GRAPH_APP_ID);
    expect(resource?.permissions['e1fe6dd8-ba31-4d61-89e7-88639da4683d']).toEqual({
      name: 'User.Read',
      type: 'Scope',
    });
  });

  it('returns undefined for an unrecognised resourceAppId', () => {
    expect(getWellKnownResourceApplication('11111111-1111-1111-1111-111111111111')).toBeUndefined();
  });
});
