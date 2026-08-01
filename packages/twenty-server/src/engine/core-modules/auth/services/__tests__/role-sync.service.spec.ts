import { EXE_MANAGED_VIEWER_ROLE } from 'src/engine/core-modules/auth/constants/exe-managed-roles.constant';
import { RoleSyncService } from 'src/engine/core-modules/auth/services/role-sync.service';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

const WORKSPACE_ID = 'ws-1';
const USER_WORKSPACE_ID = 'uw-1';
const ADMIN_ROLE_ID = 'role-admin';
const MEMBER_ROLE_ID = 'role-member';
const VIEWER_ROLE_ID = 'role-viewer';

const createService = () => {
  const roleService = {
    getRoleByUniversalIdentifier: jest.fn(),
    createRole: jest.fn(),
  };
  const userRoleService = {
    getRolesByUserWorkspaces: jest.fn().mockResolvedValue(new Map()),
    assignRoleToManyUserWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const applicationService = {
    findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
      .fn()
      .mockResolvedValue({
        workspaceCustomFlatApplication: { id: 'app-1', universalIdentifier: 'app-uid' },
      }),
  };
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue({ defaultRoleId: MEMBER_ROLE_ID }),
  };

  const service = new RoleSyncService(
    roleService as any,
    userRoleService as any,
    applicationService as any,
    workspaceRepository as any,
  );

  return { service, roleService, userRoleService, applicationService, workspaceRepository };
};

describe('RoleSyncService.applyCrmTier — resolves + assigns the mapped role', () => {
  it('admin tier → seeded Admin role (by universalIdentifier)', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue({ id: ADMIN_ROLE_ID });

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'admin',
    });

    expect(roleService.getRoleByUniversalIdentifier).toHaveBeenCalledWith({
      universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
      workspaceId: WORKSPACE_ID,
    });
    expect(userRoleService.assignRoleToManyUserWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userWorkspaceIds: [USER_WORKSPACE_ID],
      roleId: ADMIN_ROLE_ID,
    });
  });

  it('write tier → workspace defaultRoleId (Member)', async () => {
    const { service, userRoleService, workspaceRepository } = createService();

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'write',
    });

    expect(workspaceRepository.findOne).toHaveBeenCalled();
    expect(userRoleService.assignRoleToManyUserWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userWorkspaceIds: [USER_WORKSPACE_ID],
      roleId: MEMBER_ROLE_ID,
    });
  });

  it('read tier, viewer exists → reuse it', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue({ id: VIEWER_ROLE_ID });

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'read',
    });

    expect(roleService.getRoleByUniversalIdentifier).toHaveBeenCalledWith({
      universalIdentifier: EXE_MANAGED_VIEWER_ROLE.universalIdentifier,
      workspaceId: WORKSPACE_ID,
    });
    expect(roleService.createRole).not.toHaveBeenCalled();
    expect(userRoleService.assignRoleToManyUserWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userWorkspaceIds: [USER_WORKSPACE_ID],
      roleId: VIEWER_ROLE_ID,
    });
  });

  it('read tier, viewer missing → creates read-only role then assigns', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue(null);
    roleService.createRole.mockResolvedValue({ id: VIEWER_ROLE_ID });

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'read',
    });

    const createArg = roleService.createRole.mock.calls[0][0];

    expect(createArg.input).toMatchObject({
      universalIdentifier: EXE_MANAGED_VIEWER_ROLE.universalIdentifier,
      canReadAllObjectRecords: true,
      canUpdateAllObjectRecords: false,
      canUpdateAllSettings: false,
    });
    expect(userRoleService.assignRoleToManyUserWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userWorkspaceIds: [USER_WORKSPACE_ID],
      roleId: VIEWER_ROLE_ID,
    });
  });
});

describe('RoleSyncService.applyCrmTier — idempotency + guards', () => {
  it('no-op when the user already holds the target role', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue({ id: ADMIN_ROLE_ID });
    userRoleService.getRolesByUserWorkspaces.mockResolvedValue(
      new Map([[USER_WORKSPACE_ID, [{ id: ADMIN_ROLE_ID }]]]),
    );

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'admin',
    });

    expect(userRoleService.assignRoleToManyUserWorkspace).not.toHaveBeenCalled();
  });

  it('none tier is never assigned (handled as fail-closed deny by caller)', async () => {
    const { service, roleService, userRoleService } = createService();

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'none' as any,
    });

    expect(roleService.getRoleByUniversalIdentifier).not.toHaveBeenCalled();
    expect(userRoleService.assignRoleToManyUserWorkspace).not.toHaveBeenCalled();
  });
});

describe('RoleSyncService.applyCrmTier — non-fatal failures Fail', () => {
  it('swallows the last-admin guard so login is not broken', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue({ id: VIEWER_ROLE_ID });
    userRoleService.assignRoleToManyUserWorkspace.mockRejectedValue(
      new PermissionsException(
        'last admin',
        PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN,
      ),
    );

    await expect(
      service.applyCrmTier({
        userWorkspaceId: USER_WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
        tier: 'read',
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows an unexpected assign failure', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue({ id: VIEWER_ROLE_ID });
    userRoleService.assignRoleToManyUserWorkspace.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      service.applyCrmTier({
        userWorkspaceId: USER_WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
        tier: 'read',
      }),
    ).resolves.toBeUndefined();
  });

  it('leaves role unchanged when the target role cannot be resolved', async () => {
    const { service, roleService, userRoleService } = createService();

    roleService.getRoleByUniversalIdentifier.mockResolvedValue(null);

    await service.applyCrmTier({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      tier: 'admin',
    });

    expect(userRoleService.assignRoleToManyUserWorkspace).not.toHaveBeenCalled();
  });
});
