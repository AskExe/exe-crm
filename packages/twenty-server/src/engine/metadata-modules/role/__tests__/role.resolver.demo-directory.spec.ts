import { type Repository } from 'typeorm';

import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { type KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type RoleDTO } from 'src/engine/metadata-modules/role/dtos/role.dto';
import { RoleResolver } from 'src/engine/metadata-modules/role/role.resolver';

describe('RoleResolver DEMO member directory', () => {
  const workspace = { id: 'demo-workspace' } as WorkspaceEntity;
  const role = { id: 'demo-role' } as RoleDTO;
  const previousDemoWorkspaceId = process.env.EXE_DEMO_WORKSPACE_ID;

  afterEach(() => {
    if (previousDemoWorkspaceId === undefined) {
      delete process.env.EXE_DEMO_WORKSPACE_ID;
    } else {
      process.env.EXE_DEMO_WORKSPACE_ID = previousDemoWorkspaceId;
    }
  });

  it('hides nested role members from a DEMO visitor', async () => {
    process.env.EXE_DEMO_WORKSPACE_ID = workspace.id;
    const getWorkspaceMembersAssignedToRole = jest.fn();
    const resolver = Object.create(RoleResolver.prototype) as RoleResolver;

    Object.assign(resolver, {
      keyValuePairRepository: {
        findOne: jest.fn().mockResolvedValue({
          value: { ownerUserIds: ['owner-one', 'owner-two'] },
        }),
      } as unknown as Repository<KeyValuePairEntity>,
      userRoleService: { getWorkspaceMembersAssignedToRole },
    });

    await expect(
      resolver.getWorkspaceMembersAssignedToRole(role, workspace, {
        id: 'visitor-user',
      } as AuthContextUser),
    ).resolves.toEqual([]);
    expect(getWorkspaceMembersAssignedToRole).not.toHaveBeenCalled();
  });

  it('allows nested role members for a canonical DEMO owner', async () => {
    process.env.EXE_DEMO_WORKSPACE_ID = workspace.id;
    const members = [{ id: 'member-one' }];
    const getWorkspaceMembersAssignedToRole = jest
      .fn()
      .mockResolvedValue(members);
    const resolver = Object.create(RoleResolver.prototype) as RoleResolver;

    Object.assign(resolver, {
      keyValuePairRepository: {
        findOne: jest.fn().mockResolvedValue({
          value: { ownerUserIds: ['owner-one', 'owner-two'] },
        }),
      } as unknown as Repository<KeyValuePairEntity>,
      userRoleService: { getWorkspaceMembersAssignedToRole },
    });

    await expect(
      resolver.getWorkspaceMembersAssignedToRole(role, workspace, {
        id: 'owner-one',
      } as AuthContextUser),
    ).resolves.toEqual(members);
    expect(getWorkspaceMembersAssignedToRole).toHaveBeenCalledWith(
      role.id,
      workspace.id,
    );
  });

  it('keeps nested role members private after DEMO admission is disabled', async () => {
    delete process.env.EXE_DEMO_WORKSPACE_ID;
    const getWorkspaceMembersAssignedToRole = jest.fn();
    const resolver = Object.create(RoleResolver.prototype) as RoleResolver;

    Object.assign(resolver, {
      keyValuePairRepository: {
        findOne: jest.fn().mockResolvedValue({
          value: { ownerUserIds: ['owner-one', 'owner-two'] },
        }),
      } as unknown as Repository<KeyValuePairEntity>,
      userRoleService: { getWorkspaceMembersAssignedToRole },
    });

    await expect(
      resolver.getWorkspaceMembersAssignedToRole(
        role,
        workspace,
        { id: 'visitor-user' } as AuthContextUser,
      ),
    ).resolves.toEqual([]);
    expect(getWorkspaceMembersAssignedToRole).not.toHaveBeenCalled();
  });
});
