/**
 * Exe unified-permissions claim extraction + capability→CRM-role mapping.
 *
 * PURE functions only (no DI, no DB) so they can be unit-tested in isolation.
 *
 * Canonical claim (source of truth = GoTrue `app_metadata`, see
 * UNIFIED-PERMISSIONS-DESIGN.md §2). The authoritative shape is PER-ORG:
 *
 *   app_metadata.exe_perms = {
 *     version: 1,
 *     orgs: {
 *       "<org_id>": { role, caps: ["crm:write", ...], version, ... }
 *     }
 *   }
 *
 * A LEGACY FLAT shape is accepted as a fallback (pre-per-org rollout):
 *
 *   app_metadata.exe_perms = { version, org, role, caps: [...] }
 *
 * Only CRM-relevant capabilities are interpreted here:
 *   crm:read | crm:write | crm:admin  (+ cross-cutting org:admin)
 * wiki:* / erp:* are intentionally ignored.
 */

/** CRM enforcement tier derived from capabilities. */
export type CrmRoleTier =
  | 'admin' // crm:admin OR org:admin  → Twenty Admin role
  | 'write' // crm:write               → Twenty Member (default) role
  | 'read' // crm:read                → Twenty Viewer (managed read-only) role
  | 'none'; // managed but no CRM caps  → managed-deny (fail closed)

/**
 * Result of reading `exe_perms` for THIS deployment's org.
 *
 * - `managed: false` → no `exe_perms` entry applies to this org. The caller
 *   MUST preserve existing native behavior (backward compatible).
 * - `managed: true`  → this org is managed; `tier` dictates enforcement.
 */
export type ExePermsResolution =
  | { managed: false }
  | { managed: true; role: string | null; caps: string[]; tier: CrmRoleTier };

type ExePermsOrgEntry = {
  role?: string | null;
  caps?: unknown;
};

/**
 * Decode a JWT payload WITHOUT verifying its signature.
 *
 * Safe here because GoTrue already authenticated the token via the
 * password grant immediately before this is called — we only need to READ
 * the embedded `app_metadata`, not to trust an untrusted token. Returns
 * `undefined` on any malformed input rather than throwing.
 */
export const decodeJwtAppMetadata = (
  accessToken: string | undefined | null,
): Record<string, unknown> | undefined => {
  if (typeof accessToken !== 'string') return undefined;

  const parts = accessToken.split('.');

  if (parts.length !== 3) return undefined;

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const appMetadata = payload?.app_metadata;

    return appMetadata && typeof appMetadata === 'object'
      ? (appMetadata as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const toCapArray = (caps: unknown): string[] =>
  Array.isArray(caps)
    ? caps.filter((c): c is string => typeof c === 'string')
    : [];

/**
 * Map a capability set (+ optional preset role name) to a CRM enforcement
 * tier. MONOTONIC: admin ⊃ write ⊃ read. `org:admin` implies admin. A
 * managed user with no CRM capability (and not a higher one) maps to `none`
 * (managed-deny). The preset role name is only consulted to short-circuit the
 * explicit deny preset (`none`); caps are otherwise the wire truth.
 */
export const mapCapsToCrmTier = (
  caps: string[],
  role?: string | null,
): CrmRoleTier => {
  const capSet = new Set(caps);

  if (capSet.has('crm:admin') || capSet.has('org:admin')) return 'admin';
  if (capSet.has('crm:write')) return 'write';
  if (capSet.has('crm:read')) return 'read';

  // Managed, but no CRM capability at all (includes the explicit `none`
  // preset and any role whose caps simply don't touch CRM) → deny.
  void role;

  return 'none';
};

/**
 * Extract the CRM-relevant permission resolution for `orgId` from a decoded
 * `app_metadata` object.
 *
 * Returns `{ managed: false }` (→ preserve native behavior) when:
 *   - there is no `exe_perms`, or
 *   - `orgId` is not configured (deployment opted out of enforcement), or
 *   - per-org shape has no entry for this org, or
 *   - legacy flat shape is scoped to a DIFFERENT org, OR is UNSCOPED (no `org`
 *     field). An unscoped flat claim is NEVER applied to an arbitrary org — the
 *     access-token is decoded without signature verification, so honoring an
 *     org-less `exe_perms` would be a forgeable cross-org escalation path. A
 *     flat claim must explicitly name THIS org to take effect.
 */
export const resolveExePermsForOrg = (
  appMetadata: Record<string, unknown> | undefined,
  orgId: string | undefined | null,
): ExePermsResolution => {
  if (!orgId) return { managed: false };

  const exePerms = appMetadata?.exe_perms as
    | ({
        orgs?: Record<string, ExePermsOrgEntry>;
        org?: string;
      } & ExePermsOrgEntry)
    | undefined;

  if (!exePerms || typeof exePerms !== 'object') return { managed: false };

  // Canonical per-org shape.
  if (exePerms.orgs && typeof exePerms.orgs === 'object') {
    const entry = exePerms.orgs[orgId];

    if (!entry || typeof entry !== 'object') return { managed: false };

    const caps = toCapArray(entry.caps);

    return {
      managed: true,
      role: entry.role ?? null,
      caps,
      tier: mapCapsToCrmTier(caps, entry.role),
    };
  }

  // Legacy flat shape — applies ONLY if it EXPLICITLY targets THIS org. An
  // unscoped flat claim (no `org` field) is rejected: with an unverified token,
  // honoring it would let a forged org-less claim grant access to any org.
  if (typeof exePerms.org === 'string' && exePerms.org === orgId) {
    const caps = toCapArray(exePerms.caps);

    return {
      managed: true,
      role: exePerms.role ?? null,
      caps,
      tier: mapCapsToCrmTier(caps, exePerms.role),
    };
  }

  return { managed: false };
};

/**
 * Parse a boolean-ish env var with an EXPLICIT default.
 *
 * Env vars are strings, so `Boolean(process.env.X)` treats "false" and "0" as
 * true, while `X === 'true'` silently turns a security default OFF for every
 * operator who wrote "1" or "yes". Both are how a default-on guard gets lost.
 *   - unset / null / whitespace-only -> defaultValue
 *   - '1' 'true' 'yes' 'on'          -> true  (case/space insensitive)
 *   - '0' 'false' 'no' 'off'         -> false
 *   - anything else (typo)           -> defaultValue, so a typo can never
 *                                      accidentally disable a default-on gate
 */
export const parseEnvBoolean = (
  raw: string | undefined | null,
  defaultValue: boolean,
): boolean => {
  if (raw === undefined || raw === null) return defaultValue;

  const value = String(raw).trim().toLowerCase();

  if (value === '') return defaultValue;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on')
    return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off')
    return false;

  return defaultValue;
};

/**
 * Whether managed (control-plane) permissions are REQUIRED before CRM will
 * create a workspace and hand its Admin role to whoever logged in first.
 *
 * DEFAULT ON (e51ca54c §10.6b): an unmanaged first login must not mint its own
 * Admin — that falsifies the promise that the dashboard is the one place roles
 * are set. Genuine self-hosted bootstrap opts out with
 * `CRM_REQUIRE_MANAGED_PERMS=false`, which is logged as a security downgrade at
 * startup.
 *
 * Read at decision time (not cached) so an operator flipping the variable and
 * restarting always gets the value they set, and so the behavior is unit
 * testable without rebuilding the Nest module.
 */
export const isManagedPermsRequired = (
  raw: string | undefined = process.env.CRM_REQUIRE_MANAGED_PERMS,
): boolean => parseEnvBoolean(raw, true);
