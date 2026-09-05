import { describe, it, expect } from 'vitest';
import {
  resolveSubmit,
  authorityOrIdentityChanged,
  titleFor,
  escapeHtml,
  isCloudSelected,
  isValidGuid,
  isTenantKindSelected,
  isAuthMethodSelected,
  isValidThumbprint,
  normalizeThumbprint,
  ConnectionFormInput,
  ExistingCredentialState,
} from './connectionFormLogic';
import { Connection } from './types';

const VALID_GUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const SHA1_THUMBPRINT = 'ab'.repeat(20); // 40 hex chars
const SHA256_THUMBPRINT = 'ab'.repeat(32); // 64 hex chars
const NO_STORED_CREDENTIALS: ExistingCredentialState = { hasClientSecret: false, hasCertificateKey: false };

const existing: Connection[] = [
  { name: 'Contoso Dev', tenantId: 'contoso.onmicrosoft.com', cloud: 'public', tenantKind: 'workforce' },
  { name: 'Fabrikam Prod', tenantId: 'fabrikam-tenant-id', cloud: 'usGov', clientId: VALID_GUID, tenantKind: 'workforce' },
];

function formInput(overrides: Partial<ConnectionFormInput> = {}): ConnectionFormInput {
  return {
    name: 'New Connection',
    tenantId: 'new.onmicrosoft.com',
    cloud: 'public',
    clientId: '',
    tenantKind: 'workforce',
    externalIdSubdomain: '',
    authMethod: 'delegated',
    clientSecret: '',
    certificateThumbprint: '',
    certificateKey: '',
    ...overrides,
  };
}

describe('resolveSubmit — Workforce, delegated', () => {
  it('returns ok with trimmed fields and no clientId when the input is blank', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ name: '  New Connection  ', tenantId: '  new.onmicrosoft.com  ', clientId: '   ' })
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'delegated',
      },
    });
  });

  it('includes a trimmed, valid clientId override when provided', () => {
    const result = resolveSubmit(existing, undefined, formInput({ cloud: 'china', clientId: `  ${VALID_GUID}  ` }));
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'china',
        tenantKind: 'workforce',
        authMethod: 'delegated',
        clientId: VALID_GUID,
      },
    });
  });

  it('reports invalidClientId when the override is not a GUID', () => {
    const result = resolveSubmit(existing, undefined, formInput({ clientId: 'my-app-name' }));
    expect(result).toEqual({ kind: 'invalidClientId' });
  });

  it('checks clientId format only after the name clash check has passed', () => {
    // Both problems are present; the clash is reported first (existing UC012 A1 precedence).
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ name: 'Contoso Dev', tenantId: 'irrelevant', clientId: 'not-a-guid' })
    );
    expect(result).toEqual({ kind: 'clash', name: 'Contoso Dev' });
  });

  it('reports a clash when adding a name that already exists, case-insensitively', () => {
    const result = resolveSubmit(existing, undefined, formInput({ name: 'contoso dev', tenantId: 'irrelevant' }));
    expect(result).toEqual({ kind: 'clash', name: 'contoso dev' });
  });

  it('does not treat an unchanged name as a clash when editing that same connection', () => {
    const result = resolveSubmit(existing, 'Contoso Dev', formInput({ name: 'Contoso Dev', tenantId: 'updated-tenant' }));
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'Contoso Dev',
        tenantId: 'updated-tenant',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'delegated',
      },
    });
  });

  it('still reports a clash when editing one connection into another existing name', () => {
    const result = resolveSubmit(existing, 'Contoso Dev', formInput({ name: 'Fabrikam Prod', tenantId: 'irrelevant' }));
    expect(result).toEqual({ kind: 'clash', name: 'Fabrikam Prod' });
  });
});

describe('resolveSubmit — External ID (CIAM)', () => {
  it('forces cloud to public and includes the subdomain, regardless of the cloud field', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({
        name: 'Contoso CIAM',
        tenantId: 'contoso-tenant-id',
        cloud: 'usGov',
        tenantKind: 'externalId',
        externalIdSubdomain: '  contoso  ',
      })
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'Contoso CIAM',
        tenantId: 'contoso-tenant-id',
        cloud: 'public',
        tenantKind: 'externalId',
        authMethod: 'delegated',
        externalIdSubdomain: 'contoso',
      },
    });
  });

  it('reports missingExternalIdSubdomain when the subdomain is blank', () => {
    const result = resolveSubmit(existing, undefined, formInput({ tenantKind: 'externalId', externalIdSubdomain: '   ' }));
    expect(result).toEqual({ kind: 'missingExternalIdSubdomain' });
  });

  it('checks the subdomain only after the clientId format check has passed', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ clientId: 'not-a-guid', tenantKind: 'externalId', externalIdSubdomain: '' })
    );
    expect(result).toEqual({ kind: 'invalidClientId' });
  });

  it('does not persist externalIdSubdomain for a Workforce connection', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ tenantKind: 'workforce', externalIdSubdomain: 'leftover-from-toggle' })
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'delegated',
      },
    });
  });
});

describe('resolveSubmit — client secret', () => {
  it('reports missingClientSecret when adding new and no secret is entered', () => {
    const result = resolveSubmit(existing, undefined, formInput({ authMethod: 'clientSecret' }), NO_STORED_CREDENTIALS);
    expect(result).toEqual({ kind: 'missingClientSecret' });
  });

  it('returns ok with the trimmed secret when one is entered', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientSecret', clientSecret: '  shh  ' }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'clientSecret',
      },
      clientSecret: 'shh',
    });
  });

  it('does not require re-entering the secret when editing a connection that already has one stored', () => {
    const result = resolveSubmit(existing, 'New Connection', formInput({ authMethod: 'clientSecret' }), {
      hasClientSecret: true,
      hasCertificateKey: false,
    });
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'clientSecret',
      },
    });
    if (result.kind === 'ok') {
      expect(result.clientSecret).toBeUndefined();
    }
  });

  it('never puts the secret on the connection object itself', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientSecret', clientSecret: 'shh' }),
      NO_STORED_CREDENTIALS
    );
    if (result.kind === 'ok') {
      expect(result.connection).not.toHaveProperty('clientSecret');
    } else {
      throw new Error('expected ok');
    }
  });
});

describe('resolveSubmit — client certificate', () => {
  it('reports missingCertificateThumbprint when blank', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientCertificate', certificateKey: 'pem' }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({ kind: 'missingCertificateThumbprint' });
  });

  it('reports invalidCertificateThumbprint for a malformed value', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientCertificate', certificateThumbprint: 'not-hex', certificateKey: 'pem' }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({ kind: 'invalidCertificateThumbprint' });
  });

  it('accepts a thumbprint with colon separators, normalizing them away', () => {
    const colonSeparated = SHA1_THUMBPRINT.match(/../g)!.join(':');
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientCertificate', certificateThumbprint: colonSeparated, certificateKey: 'pem' }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: expect.objectContaining({ certificateThumbprint: SHA1_THUMBPRINT }),
      certificateKey: 'pem',
    });
  });

  it('reports missingCertificateKey when the thumbprint is valid but no key is entered', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientCertificate', certificateThumbprint: SHA1_THUMBPRINT }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({ kind: 'missingCertificateKey' });
  });

  it('does not require re-entering the key when editing a connection that already has one stored', () => {
    const result = resolveSubmit(
      existing,
      'New Connection',
      formInput({ authMethod: 'clientCertificate', certificateThumbprint: SHA1_THUMBPRINT }),
      { hasClientSecret: false, hasCertificateKey: true }
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.certificateKey).toBeUndefined();
      expect(result.connection.certificateThumbprint).toBe(SHA1_THUMBPRINT);
    }
  });

  it('returns ok with both the thumbprint and the trimmed key when both are provided', () => {
    const result = resolveSubmit(
      existing,
      undefined,
      formInput({ authMethod: 'clientCertificate', certificateThumbprint: SHA256_THUMBPRINT, certificateKey: '  pem-key  ' }),
      NO_STORED_CREDENTIALS
    );
    expect(result).toEqual({
      kind: 'ok',
      connection: {
        name: 'New Connection',
        tenantId: 'new.onmicrosoft.com',
        cloud: 'public',
        tenantKind: 'workforce',
        authMethod: 'clientCertificate',
        certificateThumbprint: SHA256_THUMBPRINT,
      },
      certificateKey: 'pem-key',
    });
  });
});

describe('authorityOrIdentityChanged', () => {
  const original: Connection = { name: 'A', tenantId: 't1', cloud: 'public', tenantKind: 'workforce', authMethod: 'delegated' };

  it('is false when nothing relevant changed', () => {
    expect(authorityOrIdentityChanged(original, { ...original, clientId: 'x' })).toBe(false);
  });

  it('is true when the name changed', () => {
    expect(authorityOrIdentityChanged(original, { ...original, name: 'B' })).toBe(true);
  });

  it('is true when the tenant ID changed', () => {
    expect(authorityOrIdentityChanged(original, { ...original, tenantId: 't2' })).toBe(true);
  });

  it('is true when the cloud changed', () => {
    expect(authorityOrIdentityChanged(original, { ...original, cloud: 'usGov' })).toBe(true);
  });

  it('is true when switching between Workforce and External ID', () => {
    expect(
      authorityOrIdentityChanged(original, { ...original, tenantKind: 'externalId', externalIdSubdomain: 'contoso' })
    ).toBe(true);
  });

  it('treats an absent tenantKind the same as "workforce"', () => {
    const legacy: Connection = { name: 'A', tenantId: 't1', cloud: 'public' };
    expect(authorityOrIdentityChanged(legacy, { ...legacy, tenantKind: 'workforce' })).toBe(false);
  });

  it('is true when the External ID subdomain changed', () => {
    const externalId: Connection = { ...original, tenantKind: 'externalId', externalIdSubdomain: 'contoso' };
    expect(authorityOrIdentityChanged(externalId, { ...externalId, externalIdSubdomain: 'fabrikam' })).toBe(true);
  });

  it('treats an absent authMethod the same as "delegated"', () => {
    const legacy: Connection = { name: 'A', tenantId: 't1', cloud: 'public' };
    expect(authorityOrIdentityChanged(legacy, { ...legacy, authMethod: 'delegated' })).toBe(false);
  });

  it('is true when switching auth method', () => {
    expect(authorityOrIdentityChanged(original, { ...original, authMethod: 'clientSecret' })).toBe(true);
  });

  it('is true when the certificate thumbprint changed', () => {
    const cert: Connection = { ...original, authMethod: 'clientCertificate', certificateThumbprint: 'a'.repeat(40) };
    expect(authorityOrIdentityChanged(cert, { ...cert, certificateThumbprint: 'b'.repeat(40) })).toBe(true);
  });
});

describe('titleFor', () => {
  it('is "Add Connection" when not editing', () => {
    expect(titleFor(undefined)).toBe('Add Connection');
  });

  it('names the connection being edited', () => {
    expect(titleFor({ name: 'Contoso Dev', tenantId: 't', cloud: 'public' })).toBe('Edit Connection: Contoso Dev');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b>Tom & "Jerry"</b>`)).toBe('&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Contoso Dev')).toBe('Contoso Dev');
  });
});

describe('isValidGuid', () => {
  it('accepts a standard lowercase GUID', () => {
    expect(isValidGuid(VALID_GUID)).toBe(true);
  });

  it('accepts an uppercase GUID', () => {
    expect(isValidGuid(VALID_GUID.toUpperCase())).toBe(true);
  });

  it.each([
    ['an app name', 'my-app-name'],
    ['a truncated GUID', '3fa85f64-5717-4562-b3fc'],
    ['a GUID wrapped in braces', `{${VALID_GUID}}`],
    ['a GUID with extra characters', `${VALID_GUID}x`],
    ['an empty string', ''],
    ['whitespace-padded (caller\'s job to trim)', ` ${VALID_GUID} `],
  ])('rejects %s', (_label, value) => {
    expect(isValidGuid(value)).toBe(false);
  });
});

describe('normalizeThumbprint', () => {
  it('strips colon separators', () => {
    expect(normalizeThumbprint('AB:CD:EF')).toBe('ABCDEF');
  });

  it('strips whitespace', () => {
    expect(normalizeThumbprint(' AB CD ')).toBe('ABCD');
  });
});

describe('isValidThumbprint', () => {
  it('accepts a 40-character SHA-1 thumbprint', () => {
    expect(isValidThumbprint(SHA1_THUMBPRINT)).toBe(true);
  });

  it('accepts a 64-character SHA-256 thumbprint', () => {
    expect(isValidThumbprint(SHA256_THUMBPRINT)).toBe(true);
  });

  it.each([
    ['an app name', 'my-app-name'],
    ['the wrong length', 'ab'.repeat(10)],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidThumbprint(value)).toBe(false);
  });
});

describe('isCloudSelected', () => {
  it('defaults an undefined current cloud to public', () => {
    expect(isCloudSelected(undefined, 'public')).toBe(true);
    expect(isCloudSelected(undefined, 'usGov')).toBe(false);
  });

  it('matches the current cloud exactly', () => {
    expect(isCloudSelected('china', 'china')).toBe(true);
    expect(isCloudSelected('china', 'public')).toBe(false);
  });
});

describe('isTenantKindSelected', () => {
  it('defaults an undefined current tenant kind to workforce', () => {
    expect(isTenantKindSelected(undefined, 'workforce')).toBe(true);
    expect(isTenantKindSelected(undefined, 'externalId')).toBe(false);
  });

  it('matches the current tenant kind exactly', () => {
    expect(isTenantKindSelected('externalId', 'externalId')).toBe(true);
    expect(isTenantKindSelected('externalId', 'workforce')).toBe(false);
  });
});

describe('isAuthMethodSelected', () => {
  it('defaults an undefined current auth method to delegated', () => {
    expect(isAuthMethodSelected(undefined, 'delegated')).toBe(true);
    expect(isAuthMethodSelected(undefined, 'clientSecret')).toBe(false);
  });

  it('matches the current auth method exactly', () => {
    expect(isAuthMethodSelected('clientCertificate', 'clientCertificate')).toBe(true);
    expect(isAuthMethodSelected('clientCertificate', 'clientSecret')).toBe(false);
  });
});
