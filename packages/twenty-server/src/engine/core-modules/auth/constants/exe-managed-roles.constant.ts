/**
 * Roles this system (Exe unified-permissions enforcement) OWNS and manages.
 *
 * Removal-scoping anchor: RoleSyncService only ever assigns one of these
 * roles, and Twenty binds exactly one role-target per userWorkspace (unique
 * index IDX_ROLE_TARGET_UNIQUE_USER_WORKSPACE), so re-pointing a managed user
 * never strips a manually-assigned role of some OTHER user.
 *
 * - Admin  → the seeded standard Admin role (looked up by universalIdentifier
 *            via STANDARD_ROLE.admin — NOT by label).
 * - Write  → the workspace's own `defaultRoleId` (the seeded "Member" role).
 * - Viewer → a managed read-only role created lazily & idempotently, keyed by
 *            this fixed universalIdentifier so it is always re-resolvable.
 */
export const EXE_MANAGED_VIEWER_ROLE = {
  // Stable, Exe-owned universalIdentifier for the managed read-only role.
  universalIdentifier: 'e0e00001-a1b2-4c3d-8e5f-6a7b8c9d0e1f',
  label: 'Viewer',
  description: 'Exe-managed read-only role (crm:read)',
} as const;

/**
 * The ONLY permission shape the managed Viewer role may ever hold: read-only
 * on object records, no write/delete, no settings, no tools. Source of truth
 * for BOTH creation and drift-repair — `ensureViewerRoleId` verifies an
 * existing Viewer against this every sync and repairs it if the flags were
 * mutated, instead of trusting the role by its universalIdentifier alone.
 */
export const EXE_MANAGED_VIEWER_PERMISSION_FLAGS = {
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  canAccessAllTools: false,
} as const;

/**
 * Managed "Member" role — the write tier (crm:write) target.
 *
 * We do NOT map crm:write to the workspace's `defaultRoleId`: that pointer is
 * MUTABLE (a local admin can repoint it at the Admin role), which would silently
 * grant a crm:write user Admin. Instead we own a verified NON-admin role the
 * same way we own the Viewer — created non-editable and self-healed every sync.
 */
export const EXE_MANAGED_MEMBER_ROLE = {
  // Stable, Exe-owned universalIdentifier for the managed read-write role.
  universalIdentifier: 'e0e00002-a1b2-4c3d-8e5f-6a7b8c9d0e2f',
  label: 'Member',
  description: 'Exe-managed read-write role (crm:write)',
} as const;

/**
 * The ONLY permission shape the managed Member role may ever hold: read + write
 * object records, but explicitly NO admin powers (no settings, no tools, no
 * destroy). Same source-of-truth + drift-repair contract as the Viewer flags.
 */
export const EXE_MANAGED_MEMBER_PERMISSION_FLAGS = {
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canDestroyAllObjectRecords: false,
  // The security invariant: a write-tier user is NEVER an admin.
  canUpdateAllSettings: false,
  canAccessAllTools: false,
} as const;
