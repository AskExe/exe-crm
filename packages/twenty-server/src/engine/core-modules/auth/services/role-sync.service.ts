import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { EXE_MANAGED_VIEWER_ROLE } from 'src/engine/core-modules/auth/constants/exe-managed-roles.constant';
import { type CrmRoleTier } from 'src/engine/core-modules/auth/services/exe-perms.util';
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
   * Reconcile the user's workspace role to match `tier`.
   *
   * Idempotent: if the user already holds the target role, no write occurs.
   * Non-fatal by contract: a reconcile failure MUST NOT break login — the
   * caller keeps the user's existing role and logs. (`none` is handled by the
   * caller as a fail-closed login denial BEFORE token issuance; it is not a
   * tier this method assigns.)
   */
  async applyCrmTier({
    userWorkspaceId,
    workspaceId,
    tier,
  }: {
    userWorkspaceId: string;
    workspaceId: string;
    tier: CrmRoleTier;
  }): Promise<void> {
    // `none` is a fail-closed login DENIAL handled by the caller before token
    // issuance — never an assignable role here.
    if (tier === 'none') return;

    const targetRoleId = await this.resolveTargetRoleId({ tier, workspaceId });

    if (!targetRoleId) {
      this.logger.warn(
        `RoleSync: could not resolve a ${tier} role for workspace ${workspaceId}; leaving existing role unchanged`,
      );

      return;
    }

    const currentRole = await this.userRoleService
      .getRolesByUserWorkspaces({
        userWorkspaceIds: [userWorkspaceId],
        workspaceId,
      })
      .then((map) => map.get(userWorkspaceId)?.[0]);

    if (currentRole?.id === targetRoleId) {
      return; // already correct — idempotent no-op
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
    } catch (err) {
      // The last-admin guard (CANNOT_UNASSIGN_LAST_ADMIN) legitimately blocks
      // demoting the only admin — never break login over it.
      if (
        err instanceof PermissionsException &&
        err.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN
      ) {
        this.logger.warn(
          `RoleSync: refused to demote the last admin (userWorkspace ${userWorkspaceId}); keeping admin role`,
        );

        return;
      }

      this.logger.error(
        `RoleSync: failed to assign ${tier} role to userWorkspace ${userWorkspaceId}: ${err}`,
      );
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
   * keyed by our fixed universalIdentifier. Created lazily & idempotently on
   * first crm:read login; reused thereafter.
   */
  private async ensureViewerRoleId(workspaceId: string): Promise<string | null> {
    const existing = await this.roleService.getRoleByUniversalIdentifier({
      universalIdentifier: EXE_MANAGED_VIEWER_ROLE.universalIdentifier,
      workspaceId,
    });

    if (existing) return existing.id;

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
        canUpdateAllSettings: false,
        canAccessAllTools: false,
        canReadAllObjectRecords: true,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
      },
      workspaceId,
      ownerFlatApplication: workspaceCustomFlatApplication,
    });

    return created.id;
  }
}
