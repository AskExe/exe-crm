import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import {
  EXE_MANAGED_VIEWER_PERMISSION_FLAGS,
  EXE_MANAGED_VIEWER_ROLE,
} from 'src/engine/core-modules/auth/constants/exe-managed-roles.constant';
import { type CrmRoleTier } from 'src/engine/core-modules/auth/services/exe-perms.util';
import { type RoleDTO } from 'src/engine/metadata-modules/role/dtos/role.dto';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

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
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
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
        // The seeded "Member" role IS the workspace's defaultRoleId — resolve
        // it structurally instead of hardcoding the "Member" label.
        const workspace = await this.workspaceRepository.findOne({
          where: { id: workspaceId },
        });

        return workspace?.defaultRoleId ?? null;
      }
      case 'read': {
        return this.ensureViewerRoleId(workspaceId);
      }
      default: {
        return null;
      }
    }
  }

  /**
   * Ensure a managed read-only ("Viewer") role exists for the workspace,
   * keyed by our fixed universalIdentifier.
   *
   * Created lazily & idempotently on first crm:read login as a NON-EDITABLE
   * (system-owned) role so a local admin cannot mutate it into a write/settings
   * role. On reuse we do NOT trust the role by identifier alone: we verify its
   * permission flags every sync and REPAIR them if they drifted (e.g. a legacy
   * Viewer that predates the non-editable lock, or any out-of-band mutation),
   * so future crm:read users can never inherit elevated access.
   */
  private async ensureViewerRoleId(workspaceId: string): Promise<string | null> {
    const existing = await this.roleService.getRoleByUniversalIdentifier({
      universalIdentifier: EXE_MANAGED_VIEWER_ROLE.universalIdentifier,
      workspaceId,
    });

    if (existing) {
      await this.repairViewerRoleIfDrifted(existing, workspaceId);

      return existing.id;
    }

    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const created = await this.roleService.createRole({
      input: {
        universalIdentifier: EXE_MANAGED_VIEWER_ROLE.universalIdentifier,
        label: EXE_MANAGED_VIEWER_ROLE.label,
        description: EXE_MANAGED_VIEWER_ROLE.description,
        icon: 'IconEye',
        // System-owned: cannot be edited or deleted via the normal migration
        // path, so its read-only flags can't be elevated by a local admin.
        isEditable: false,
        ...EXE_MANAGED_VIEWER_PERMISSION_FLAGS,
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
   * Verify an existing managed Viewer role against the canonical read-only
   * flag set and repair it if any flag drifted. Non-fatal: a repair failure
   * (e.g. the role is locked non-editable but somehow drifted, or an infra
   * error) never breaks login — worst case the caller assigns a role that is
   * already read-only in the common path.
   */
  private async repairViewerRoleIfDrifted(
    role: RoleDTO,
    workspaceId: string,
  ): Promise<void> {
    const expected = EXE_MANAGED_VIEWER_PERMISSION_FLAGS;

    const drifted = (
      Object.keys(expected) as (keyof typeof expected)[]
    ).some((flag) => role[flag] !== expected[flag]);

    if (!drifted) return;

    this.logger.warn(
      `RoleSync: managed Viewer role ${role.id} drifted from read-only in workspace ${workspaceId}; repairing`,
    );

    try {
      await this.roleService.updateRole({
        input: { id: role.id, update: { ...expected } },
        workspaceId,
      });

      this.logger.log(
        `RoleSync: repaired managed Viewer role ${role.id} back to read-only (workspace ${workspaceId})`,
      );
    } catch (err) {
      this.logger.error(
        `RoleSync: failed to repair managed Viewer role ${role.id} in workspace ${workspaceId}: ${err}`,
      );
    }
  }
}
