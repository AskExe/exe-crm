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
 * - `managed: false` → the identity carries NO `exe_perms` claim at all, or this
 *   deployment has enforcement off (`EXE_ORG_ID` unset). The caller MUST
 *   preserve existing native behavior (backward compatible).
 * - `managed: true`  → this identity is Exe-managed; `tier` dictates
 *   enforcement, and `tier: 'none'` is a managed-DENY (fail closed).
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
 * Loud warning emitted once at startup when `EXE_ORG_ID` is unset. Enforcement
 * being off is a supported (back-compatible) configuration, but it must never
 * be a SILENT one — a silently-unenforced deployment is exactly how
 * "we thought authz was on" happens.
 */
export const EXE_PERMS_ENFORCEMENT_DISABLED_WARNING =
  'EXE_ORG_ID is not set — Exe unified-permissions (exe_perms) enforcement is ' +
  'DISABLED. Every GoTrue login falls through to native Twenty provisioning ' +
  'with default access, even when the identity carries an exe_perms claim. Set ' +
  'EXE_ORG_ID (and EXE_ORG_WORKSPACE_ID) to enable CRM RBAC enforcement.';

/**
 * A managed identity we cannot bind to a capability for THIS org. Tier `none`
 * drives the caller's existing managed-deny (403) path.
 */
const managedDeny = (): ExePermsResolution => ({
  managed: true,
  role: null,
  caps: [],
  tier: 'none',
});

/**
 * KEY presence, not truthiness. The distinction between "no exe_perms claim at
 * all" (unmanaged, legacy) and "an exe_perms claim whose value is malformed"
 * (managed, must fail closed) is the whole point — testing truthiness would let
 * `exe_perms: null` or `exe_perms: 0` fail OPEN.
 */
const hasExePermsClaim = (
  appMetadata: Record<string, unknown> | undefined,
): boolean =>
  !!appMetadata &&
  typeof appMetadata === 'object' &&
  Object.prototype.hasOwnProperty.call(appMetadata, 'exe_perms');

/**
 * Extract the CRM-relevant permission resolution for `orgId` from a decoded
 * `app_metadata` object.
 *
 * Three-case model, matching exe-wiki (`mapCaps.resolveOrgPerms`) and exe-erp
 * (`exe_perms.compute_decision`):
 *
 * 1. `exe_perms` KEY entirely ABSENT → `{ managed: false }`. The identity is
 *    not Exe-managed, so native Twenty behavior is preserved (back-compat).
 * 2. `orgId` NOT configured (`EXE_ORG_ID` unset) → `{ managed: false }`.
 *    Enforcement is opted out deployment-wide; tightening this would break
 *    every existing unmanaged CRM deployment. `EXE_PERMS_ENFORCEMENT_DISABLED_WARNING`
 *    is logged at startup so this is never silent.
 * 3. `exe_perms` PRESENT and `orgId` configured, but the claim cannot be bound
 *    to that org → MANAGED-DENY (`tier: 'none'`), i.e. FAIL CLOSED. This covers:
 *      - a malformed/scalar/null claim value,
 *      - per-org shape carrying no entry for this org,
 *      - legacy flat shape scoped to a DIFFERENT org,
 *      - legacy flat shape that is UNSCOPED (no `org` field). The access token
 *        is decoded WITHOUT signature verification, so honoring an org-less
 *        claim would be a forgeable cross-org escalation path. A flat claim
 *        must explicitly name THIS org to take effect.
 *    Previously all of case (3) returned `{ managed: false }`, which dropped the
 *    caller into native provisioning with full default access — a fail-OPEN hole
 *    that neither wiki nor ERP had.
 */
export const resolveExePermsForOrg = (
  appMetadata: Record<string, unknown> | undefined,
  orgId: string | undefined | null,
): ExePermsResolution => {
  // (1) Genuinely no claim → unmanaged, native behavior.
  if (!hasExePermsClaim(appMetadata)) return { managed: false };

  // (2) Enforcement disabled deployment-wide → unmanaged, native behavior.
  if (!orgId) return { managed: false };

  const exePerms = appMetadata?.exe_perms as
    | ({
        orgs?: Record<string, ExePermsOrgEntry>;
        org?: string;
      } & ExePermsOrgEntry)
    | undefined;

  // (3a) Claim present but not a usable object (scalar, null, …) → fail closed.
  if (!exePerms || typeof exePerms !== 'object') return managedDeny();

  // Canonical per-org shape.
  if (exePerms.orgs && typeof exePerms.orgs === 'object') {
    const entry = exePerms.orgs[orgId];

    // (3b) Managed identity with no entry for THIS org → fail closed. Removing
    // a user's org claim must be a DOWNGRADE, never a bypass to native access.
    if (!entry || typeof entry !== 'object') return managedDeny();

    const caps = toCapArray(entry.caps);

    return {
      managed: true,
      role: entry.role ?? null,
      caps,
      tier: mapCapsToCrmTier(caps, entry.role),
    };
  }

  // Legacy flat shape — applies ONLY if it EXPLICITLY targets THIS org.
  if (typeof exePerms.org === 'string' && exePerms.org === orgId) {
    const caps = toCapArray(exePerms.caps);

    return {
      managed: true,
      role: exePerms.role ?? null,
      caps,
      tier: mapCapsToCrmTier(caps, exePerms.role),
    };
  }

  // (3c) Flat claim naming a different org, or unscoped → fail closed.
  return managedDeny();
};
