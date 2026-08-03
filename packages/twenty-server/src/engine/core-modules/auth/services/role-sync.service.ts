import { Injectable, Logger } from '@nestjs/common';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import {
  EXE_MANAGED_MEMBER_PERMISSION_FLAGS,
  EXE_MANAGED_MEMBER_ROLE,
  EXE_MANAGED_VIEWER_PERMISSION_FLAGS,
  EXE_MANAGED_VIEWER_ROLE,
} from 'src/engine/core-modules/auth/constants/exe-managed-roles.constant';
import { type CrmRoleTier } from 'src/engine/core-modules/auth/services/exe-perms.util';
import { type RoleDTO } from 'src/engine/metadata-modules/role/dtos/role.dto';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

/** A managed role we OWN: fixed identity + the only permission flags it may hold. */
type ManagedRoleSpec = {
  universalIdentifier: string;
  label: string;
  description: string;
  icon: string;
  flags: Record<string, boolean>;
};

const VIEWER_SPEC: ManagedRoleSpec = {
  ...EXE_MANAGED_VIEWER_ROLE,
  icon: 'IconEye',
  flags: EXE_MANAGED_VIEWER_PERMISSION_FLAGS,
};

const MEMBER_SPEC: ManagedRoleSpec = {
  ...EXE_MANAGED_MEMBER_ROLE,
  icon: 'IconUser',
  flags: EXE_MANAGED_MEMBER_PERMISSION_FLAGS,
};

/**
 * Applies a canonical CRM capability tier to a Twenty user's workspace-scoped
 * role by re-pointing their single role-target (§3.2C of the unified
 * permissions design).
 *
 * Twenty roles are WORKSPACE-SCOPED and each userWorkspace holds exactly ONE
 * role-target (unique index). `UserRoleService.assignRoleToManyUserWorkspace`
 * already reconciles by deleting any prior role-target for that userWorkspace
 * and creating the new one atomically — so an "upsert + remove prior managed
 * role-target" is a single call. Removal is inherently scoped to THIS user's
 * membership; other users' roles are untouched.
 *
 * ORG ↔ WORKSPACE assumption (design R1 / D-4): v1 assumes this deployment's
 * org maps 1:1 to the resolved Twenty workspace. Caps therefore apply to that
 * workspace. Multi-workspace-per-org is out of scope for v1.
 */

/**
 * Outcome of a reconcile attempt. The caller uses this to decide whether a
 * MANAGED session may be minted:
 *
 * - `applied`  — the role was re-pointed to match the tier.
 * - `noop`     — already correct (or a non-assignable `none`).
 * - `unresolved` — the target role could not be resolved; existing role kept.
 * - `blocked_last_admin` — a demotion to a non-admin tier was refused because
 *   the user is the workspace's ONLY admin. The user therefore STILL holds
 *   Admin, which their caps do NOT grant. The caller MUST fail closed for
 *   non-admin tiers (never mint a session for a role the caps don't grant).
 * - `error`    — an unexpected failure; existing role kept (non-fatal).
 */
export type ApplyCrmTierResult = {
  status: 'applied' | 'noop' | 'unresolved' | 'blocked_last_admin' | 'error';
};

@Injectable()
export class RoleSyncService {
  private readonly logger = new Logger(RoleSyncService.name);

  constructor(
    private readonly roleService: RoleService,
    private readonly userRoleService: UserRoleService,
    private readonly applicationService: ApplicationService,
  ) {}

  /**
   * Reconcile the user's workspace role to match `tier`, returning a structured
   * outcome (see {@link ApplyCrmTierResult}).
   *
   * Idempotent: if the user already holds the target role, no write occurs.
   * A reconcile failure never THROWS (login is not broken by an infra error),
   * but the returned status lets the caller enforce fail-closed decisions —
   * crucially `blocked_last_admin`, where a non-admin user would otherwise
   * retain Admin. (`none` is handled by the caller as a fail-closed login
   * denial BEFORE token issuance; it is not a tier this method assigns.)
   */
  async applyCrmTier({
    userWorkspaceId,
    workspaceId,
    tier,
  }: {
    userWorkspaceId: string;
    workspaceId: string;
    tier: CrmRoleTier;
  }): Promise<ApplyCrmTierResult> {
    // `none` is a fail-closed login DENIAL handled by the caller before token
    // issuance — never an assignable role here.
    if (tier === 'none') return { status: 'noop' };

    const targetRoleId = await this.resolveTargetRoleId({ tier, workspaceId });

    if (!targetRoleId) {
      this.logger.warn(
        `RoleSync: could not resolve a ${tier} role for workspace ${workspaceId}; leaving existing role unchanged`,
      );

      return { status: 'unresolved' };
    }

    const currentRole = await this.userRoleService
      .getRolesByUserWorkspaces({
        userWorkspaceIds: [userWorkspaceId],
        workspaceId,
      })
      .then((map) => map.get(userWorkspaceId)?.[0]);

    if (currentRole?.id === targetRoleId) {
      return { status: 'noop' }; // already correct — idempotent no-op
    }

    try {
      await this.userRoleService.assignRoleToManyUserWorkspace({
        workspaceId,
        userWorkspaceIds: [userWorkspaceId],
        roleId: targetRoleId,
      });

      this.logger.log(
        `RoleSync: userWorkspace ${userWorkspaceId} → ${tier} role ${targetRoleId} (workspace ${workspaceId})`,
      );

      return { status: 'applied' };
    } catch (err) {
      // The last-admin guard (CANNOT_UNASSIGN_LAST_ADMIN) blocks demoting the
      // only admin. We do NOT throw (login isn't broken by an infra concern),
      // but we SIGNAL it: for a non-admin tier this means the user would keep
      // an Admin role their caps don't grant, so the caller must fail closed.
      if (
        err instanceof PermissionsException &&
        err.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN
      ) {
        this.logger.warn(
          `RoleSync: could not demote the last admin (userWorkspace ${userWorkspaceId}); caller must fail closed for non-admin tiers`,
        );

        return { status: 'blocked_last_admin' };
      }

      this.logger.error(
        `RoleSync: failed to assign ${tier} role to userWorkspace ${userWorkspaceId}: ${err}`,
      );

      return { status: 'error' };
    }
  }

  private async resolveTargetRoleId({
    tier,
    workspaceId,
  }: {
    tier: CrmRoleTier;
    workspaceId: string;
  }): Promise<string | null> {
    switch (tier) {
      case 'admin': {
        const adminRole = await this.roleService.getRoleByUniversalIdentifier({
          universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
          workspaceId,
        });

        return adminRole?.id ?? null;
      }
      case 'write': {
        // NEVER the workspace's mutable `defaultRoleId` — a local admin can
        // repoint it at the Admin role, silently escalating every crm:write
        // user. Use a verified, Exe-owned NON-admin Member role instead.
        return this.ensureManagedRoleId(MEMBER_SPEC, workspaceId);
      }
      case 'read': {
        return this.ensureManagedRoleId(VIEWER_SPEC, workspaceId);
      }
      default: {
        return null;
      }
    }
  }

  /**
   * Ensure a managed role (Viewer / Member) we OWN exists for the workspace,
   * keyed by its fixed universalIdentifier, and return an id that is SAFE to
   * assign.
   *
   * Created lazily & idempotently as a NON-EDITABLE (system-owned) role so a
   * local admin cannot mutate its flags. On reuse we do NOT trust the role by
   * identifier alone: every sync we verify its permission flags AND its
   * `isEditable` lock, repairing any drift (e.g. a legacy role that predates the
   * lock, or an out-of-band mutation). If a drifted role CANNOT be secured, we
   * return `null` so the caller FAILS CLOSED rather than assigning a role whose
   * permissions we can no longer guarantee.
   */
  private async ensureManagedRoleId(
    spec: ManagedRoleSpec,
    workspaceId: string,
  ): Promise<string | null> {
    const existing = await this.roleService.getRoleByUniversalIdentifier({
      universalIdentifier: spec.universalIdentifier,
      workspaceId,
    });

    if (existing) {
      const secured = await this.repairManagedRoleIfDrifted(
        existing,
        spec,
        workspaceId,
      );

      return secured ? existing.id : null;
    }

    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const created = await this.roleService.createRole({
      input: {
        universalIdentifier: spec.universalIdentifier,
        label: spec.label,
        description: spec.description,
        icon: spec.icon,
        // System-owned: cannot be edited or deleted via the normal migration
        // path, so its flags can't be elevated by a local admin.
        isEditable: false,
        ...spec.flags,
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
      },
      workspaceId,
      ownerFlatApplication: workspaceCustomFlatApplication,
    });

    return created.id;
  }

  /**
   * Verify an existing managed role against its canonical flag set AND its
   * `isEditable: false` lock, repairing any drift. Returns `true` when the role
   * is secured (either already correct, or successfully repaired), `false` when
   * a drifted role could NOT be secured — the caller then fails closed rather
   * than assigning a role we can no longer guarantee.
   */
  private async repairManagedRoleIfDrifted(
    role: RoleDTO,
    spec: ManagedRoleSpec,
    workspaceId: string,
  ): Promise<boolean> {
    const roleFlags = role as unknown as Record<string, unknown>;
    const flagsDrifted = Object.keys(spec.flags).some(
      (flag) => roleFlags[flag] !== spec.flags[flag],
    );
    // A legacy managed role created before the lock stays user-editable and so
    // remains mutable — repair it to system-owned too, not just its flags.
    const editableDrifted = role.isEditable !== false;

    if (!flagsDrifted && !editableDrifted) return true;

    this.logger.warn(
      `RoleSync: managed role "${spec.label}" ${role.id} drifted in workspace ${workspaceId} ` +
        `(flags=${flagsDrifted}, editable=${editableDrifted}); repairing to system-owned`,
    );

    try {
      await this.roleService.updateRole({
        input: {
          id: role.id,
          // Reset flags to the canonical set AND re-lock isEditable. The
          // migration validator checks the EXISTING role's editability, so a
          // currently-editable legacy role can be locked in this single update.
          update: { ...spec.flags, isEditable: false },
        },
        workspaceId,
      });

      this.logger.log(
        `RoleSync: repaired + locked managed role "${spec.label}" ${role.id} (workspace ${workspaceId})`,
      );

      return true;
    } catch (err) {
      // Loudly: a managed role we could not secure is a security concern. Fail
      // closed for this login rather than silently trusting a mutable role.
      this.logger.error(
        `RoleSync: FAILED to secure managed role "${spec.label}" ${role.id} in workspace ${workspaceId} — failing closed: ${err}`,
      );

      return false;
    }
  }
}
