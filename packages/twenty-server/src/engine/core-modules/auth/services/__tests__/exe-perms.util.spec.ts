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

describe('resolveExePermsForOrg — unmanaged (preserve native behavior) Fail', () => {
  it.each<{ label: string; appMetadata: Record<string, unknown> | undefined }>([
    { label: 'no app_metadata', appMetadata: undefined },
    { label: 'no exe_perms', appMetadata: { provider: 'email' } },
    {
      label: 'per-org shape without this org',
      appMetadata: { exe_perms: { orgs: { other: { caps: ['crm:admin'] } } } },
    },
    {
      label: 'flat shape scoped to a different org',
      appMetadata: { exe_perms: { org: 'other', caps: ['crm:admin'] } },
    },
    {
      // SECURITY: an unscoped flat claim (no `org`) must NEVER apply to an
      // arbitrary org — the token is decoded without signature verification, so
      // honoring it would be a forgeable cross-org escalation.
      label: 'UNSCOPED flat shape (no org field) — must not apply to any org',
      appMetadata: { exe_perms: { role: 'admin', caps: ['crm:admin'] } },
    },
    {
      label: 'flat shape with a non-string org field',
      appMetadata: { exe_perms: { org: 123, caps: ['crm:admin'] } },
    },
  ])('returns managed:false for $label', ({ appMetadata }) => {
    expect(resolveExePermsForOrg(appMetadata, ORG)).toEqual({ managed: false });
  });

  it('returns managed:false when org id is not configured', () => {
    const appMetadata = {
      exe_perms: { orgs: { [ORG]: { caps: ['crm:admin'] } } },
    };

    expect(resolveExePermsForOrg(appMetadata, undefined)).toEqual({
      managed: false,
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
