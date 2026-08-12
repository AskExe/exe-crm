import {
  type CrmRoleTier,
  decodeJwtAppMetadata,
  mapCapsToCrmTier,
  resolveExePermsForOrg,
} from 'src/engine/core-modules/auth/services/exe-perms.util';

const ORG = 'acme';

const encodeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return `${header}.${body}.signature`;
};

describe('mapCapsToCrmTier', () => {
  it.each<{ caps: string[]; expected: CrmRoleTier }>([
    { caps: ['crm:admin'], expected: 'admin' },
    { caps: ['org:admin'], expected: 'admin' },
    { caps: ['crm:write'], expected: 'write' },
    { caps: ['crm:read'], expected: 'read' },
    // monotonic: highest wins
    { caps: ['crm:read', 'crm:write', 'crm:admin'], expected: 'admin' },
    { caps: ['crm:read', 'crm:write'], expected: 'write' },
    // wiki/erp caps are ignored for CRM
    { caps: ['wiki:admin', 'erp:write', 'crm:read'], expected: 'read' },
  ])('maps $caps → $expected', ({ caps, expected }) => {
    expect(mapCapsToCrmTier(caps)).toBe(expected);
  });

  it.each<{ label: string; caps: string[]; role: string | null }>([
    { label: 'empty caps', caps: [], role: 'none' },
    {
      label: 'only non-crm caps',
      caps: ['wiki:admin', 'erp:admin'],
      role: 'member',
    },
  ])('maps managed-but-no-crm ($label) → none', ({ caps, role }) => {
    expect(mapCapsToCrmTier(caps, role)).toBe('none');
  });
});

describe('resolveExePermsForOrg — managed (per-org canonical shape)', () => {
  it('resolves the entry for this org', () => {
    const appMetadata = {
      exe_perms: {
        version: 1,
        orgs: {
          [ORG]: { role: 'manager', caps: ['crm:write', 'crm:read'] },
        },
      },
    };

    expect(resolveExePermsForOrg(appMetadata, ORG)).toEqual({
      managed: true,
      role: 'manager',
      caps: ['crm:write', 'crm:read'],
      tier: 'write',
    });
  });

  it('resolves admin via org:admin cap', () => {
    const appMetadata = {
      exe_perms: { orgs: { [ORG]: { role: 'admin', caps: ['org:admin'] } } },
    };

    expect(resolveExePermsForOrg(appMetadata, ORG)).toMatchObject({
      managed: true,
      tier: 'admin',
    });
  });

  it('resolves managed-deny (none) for role none', () => {
    const appMetadata = {
      exe_perms: { orgs: { [ORG]: { role: 'none', caps: [] } } },
    };

    expect(resolveExePermsForOrg(appMetadata, ORG)).toMatchObject({
      managed: true,
      tier: 'none',
    });
  });
});

describe('resolveExePermsForOrg — managed (legacy flat shape)', () => {
  it('resolves flat shape scoped to this org', () => {
    const appMetadata = {
      exe_perms: { org: ORG, role: 'viewer', caps: ['crm:read'] },
    };

    expect(resolveExePermsForOrg(appMetadata, ORG)).toEqual({
      managed: true,
      role: 'viewer',
      caps: ['crm:read'],
      tier: 'read',
    });
  });

  it('resolves flat shape ONLY when it explicitly names this org', () => {
    const appMetadata = {
      exe_perms: { org: ORG, role: 'admin', caps: ['crm:admin'] },
    };

    expect(resolveExePermsForOrg(appMetadata, ORG)).toMatchObject({
      managed: true,
      tier: 'admin',
    });
  });
});

describe('resolveExePermsForOrg — unmanaged (preserve native behavior)', () => {
  it.each<{ label: string; appMetadata: Record<string, unknown> | undefined }>([
    { label: 'no app_metadata', appMetadata: undefined },
    { label: 'no exe_perms key', appMetadata: { provider: 'email' } },
  ])('returns managed:false for $label', ({ appMetadata }) => {
    expect(resolveExePermsForOrg(appMetadata, ORG)).toEqual({ managed: false });
  });

  it('returns managed:false when EXE_ORG_ID is not configured', () => {
    const appMetadata = {
      exe_perms: { orgs: { [ORG]: { caps: ['crm:admin'] } } },
    };

    expect(resolveExePermsForOrg(appMetadata, undefined)).toEqual({
      managed: false,
    });
  });
});

/**
 * REGRESSION (fail-open authz hole). Every case below previously returned
 * `{ managed: false }`, which dropped the caller into NATIVE Twenty
 * provisioning with full default access. A PRESENT `exe_perms` claim marks a
 * MANAGED identity, so when it cannot be bound to the configured org it must
 * resolve to a managed-DENY (`tier: 'none'`) — matching exe-wiki
 * (`{ managed: true, denied: true }`) and exe-erp (`ORG_DENY_NO_CLAIM`).
 */
describe('resolveExePermsForOrg — claim present but unresolvable for this org Fail', () => {
  it.each<{ label: string; appMetadata: Record<string, unknown> }>([
    {
      label: 'per-org shape naming a DIFFERENT org',
      appMetadata: { exe_perms: { orgs: { other: { caps: ['crm:admin'] } } } },
    },
    {
      label: 'per-org shape with an empty orgs map',
      appMetadata: { exe_perms: { orgs: {} } },
    },
    {
      label: 'per-org entry for this org that is a scalar, not an object',
      appMetadata: { exe_perms: { orgs: { [ORG]: 'admin' } } },
    },
    {
      label: 'flat shape scoped to a DIFFERENT org',
      appMetadata: { exe_perms: { org: 'other', caps: ['crm:admin'] } },
    },
    {
      // SECURITY: an unscoped flat claim (no `org`) must NEVER apply to an
      // arbitrary org — the token is decoded without signature verification, so
      // honoring it would be a forgeable cross-org escalation.
      label: 'UNSCOPED flat shape (no org field) naming no org',
      appMetadata: { exe_perms: { role: 'admin', caps: ['crm:admin'] } },
    },
    {
      label: 'flat shape with a non-string org field',
      appMetadata: { exe_perms: { org: 123, caps: ['crm:admin'] } },
    },
    {
      label: 'malformed scalar claim (string)',
      appMetadata: { exe_perms: 'admin' },
    },
    { label: 'malformed scalar claim (number)', appMetadata: { exe_perms: 7 } },
    {
      label: 'malformed scalar claim (false)',
      appMetadata: { exe_perms: false },
    },
    { label: 'null claim value', appMetadata: { exe_perms: null } },
    { label: 'empty object claim', appMetadata: { exe_perms: {} } },
    { label: 'array claim', appMetadata: { exe_perms: ['crm:admin'] } },
  ])('denies (managed, tier none) for $label', ({ appMetadata }) => {
    expect(resolveExePermsForOrg(appMetadata, ORG)).toEqual({
      managed: true,
      role: null,
      caps: [],
      tier: 'none',
    });
  });
});

describe('decodeJwtAppMetadata', () => {
  it('decodes app_metadata from a JWT payload', () => {
    const token = encodeJwt({
      sub: 'u1',
      app_metadata: { exe_perms: { orgs: { [ORG]: { caps: ['crm:read'] } } } },
    });

    expect(decodeJwtAppMetadata(token)).toEqual({
      exe_perms: { orgs: { [ORG]: { caps: ['crm:read'] } } },
    });
  });

  it('returns undefined when the token has no app_metadata', () => {
    expect(decodeJwtAppMetadata(encodeJwt({ sub: 'u1' }))).toBeUndefined();
  });
});

describe('decodeJwtAppMetadata Fail', () => {
  it.each<{ label: string; token: string | undefined | null }>([
    { label: 'undefined', token: undefined },
    { label: 'null', token: null },
    { label: 'not a jwt', token: 'not-a-jwt' },
    { label: 'wrong segment count', token: 'a.b' },
    { label: 'non-base64 payload', token: 'a.!!!.c' },
  ])('returns undefined for $label', ({ token }) => {
    expect(decodeJwtAppMetadata(token)).toBeUndefined();
  });
});
