import { describe, it, expect } from 'vitest';
import { describeRequiredPermission, MICROSOFT_GRAPH_APP_ID } from './wellKnownPermissions';

describe('describeRequiredPermission', () => {
  it('resolves a known Microsoft Graph application permission (Role)', () => {
    expect(describeRequiredPermission(MICROSOFT_GRAPH_APP_ID, '7ab1d382-f21e-4acd-a863-ba3e13f7da61')).toBe(
      'Directory.Read.All'
    );
  });

  it('resolves a known Microsoft Graph delegated permission (Scope)', () => {
    expect(describeRequiredPermission(MICROSOFT_GRAPH_APP_ID, 'e1fe6dd8-ba31-4d61-89e7-88639da4683d')).toBe('User.Read');
  });

  it('returns undefined for an unrecognised permission id under a known resourceAppId', () => {
    expect(describeRequiredPermission(MICROSOFT_GRAPH_APP_ID, 'not-a-real-id')).toBeUndefined();
  });

  it('returns undefined for an unrecognised resourceAppId', () => {
    expect(describeRequiredPermission('11111111-1111-1111-1111-111111111111', '7ab1d382-f21e-4acd-a863-ba3e13f7da61')).toBeUndefined();
  });
});
