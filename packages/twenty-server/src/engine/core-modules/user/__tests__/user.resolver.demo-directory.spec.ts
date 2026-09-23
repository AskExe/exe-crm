import { type Repository } from 'typeorm';

import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { type KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserResolver } from 'src/engine/core-modules/user/user.resolver';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

describe('UserResolver DEMO member directory', () => {
  const demoWorkspace = { id: 'demo-workspace' } as WorkspaceEntity;
  const user = {} as UserEntity;
  const authUser = { id: 'visitor-user' } as AuthContextUser;
  const previousDemoWorkspaceId = process.env.EXE_DEMO_WORKSPACE_ID;

  afterEach(() => {
    if (previousDemoWorkspaceId === undefined) {
      delete process.env.EXE_DEMO_WORKSPACE_ID;
    } else {
      process.env.EXE_DEMO_WORKSPACE_ID = previousDemoWorkspaceId;
    }
  });

  const buildResolver = (markerValue: JSON | null) => {
    const loadWorkspaceMembers = jest.fn();
    const loadDeletedWorkspaceMembersOnly = jest.fn();
    const keyValuePairRepository = {
      findOne: jest.fn().mockResolvedValue(
        markerValue === null
          ? null
          : {
              value: markerValue,
            },
      ),
    } as unknown as Repository<KeyValuePairEntity>;
    const resolver = Object.create(UserResolver.prototype) as UserResolver;

    Object.assign(resolver, {
      keyValuePairRepository,
      userRoleService: {
        getRolesByUserWorkspaces: jest.fn().mockResolvedValue(new Map()),
      },
      userService: {
        loadWorkspaceMembers: loadWorkspaceMembers.mockResolvedValue([]),
        loadDeletedWorkspaceMembersOnly:
          loadDeletedWorkspaceMembersOnly.mockResolvedValue([]),
      },
      userWorkspaceRepository: { find: jest.fn().mockResolvedValue([]) },
      workspaceMemberTranspiler: {
        toDeletedWorkspaceMemberDtos: jest.fn().mockReturnValue([]),
        toWorkspaceMemberDtos: jest.fn().mockReturnValue([]),
      },
    });

    return {
      keyValuePairRepository,
      loadDeletedWorkspaceMembersOnly,
      loadWorkspaceMembers,
      resolver,
    };
  };

  it.each([
    null,
    {} as JSON,
    { ownerUserIds: ['owner-one'] } as unknown as JSON,
    { ownerUserIds: ['owner-one', 'owner-one'] } as unknown as JSON,
    { ownerUserIds: ['owner-one', 'owner-two'] } as unknown as JSON,
  ])(
    'hides active and deleted members from a non-owner',
    async (markerValue) => {
      process.env.EXE_DEMO_WORKSPACE_ID = demoWorkspace.id;
      const {
        loadDeletedWorkspaceMembersOnly,
        loadWorkspaceMembers,
        resolver,
      } = buildResolver(markerValue);

      await expect(
        resolver.workspaceMembers(user, authUser, demoWorkspace),
      ).resolves.toEqual([]);
      await expect(
        resolver.deletedWorkspaceMembers(user, authUser, demoWorkspace),
      ).resolves.toEqual([]);
      expect(loadWorkspaceMembers).not.toHaveBeenCalled();
      expect(loadDeletedWorkspaceMembersOnly).not.toHaveBeenCalled();
    },
  );

  it('consults only the fixed DEMO marker for directory access', async () => {
    process.env.EXE_DEMO_WORKSPACE_ID = demoWorkspace.id;
    const { keyValuePairRepository, resolver } = buildResolver({
      ownerUserIds: ['owner-one', 'owner-two'],
    } as unknown as JSON);

    await resolver.workspaceMembers(user, authUser, demoWorkspace);

    expect(keyValuePairRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        key: 'exe.demo-workspace-bootstrap.v1',
        workspaceId: demoWorkspace.id,
      }),
    });
  });

  it('keeps the directory available to a canonical DEMO owner', async () => {
    process.env.EXE_DEMO_WORKSPACE_ID = demoWorkspace.id;
    const owner = { id: 'owner-one' } as AuthContextUser;
    const { loadDeletedWorkspaceMembersOnly, loadWorkspaceMembers, resolver } =
      buildResolver({
        ownerUserIds: ['owner-one', 'owner-two'],
      } as unknown as JSON);

    await resolver.workspaceMembers(user, owner, demoWorkspace);
    await resolver.deletedWorkspaceMembers(user, owner, demoWorkspace);

    expect(loadWorkspaceMembers).toHaveBeenCalledWith(demoWorkspace, false);
    expect(loadDeletedWorkspaceMembersOnly).toHaveBeenCalledWith(demoWorkspace);
  });

  it.each([undefined, 'another-workspace'])(
    'keeps both DEMO directories private when the admission env is %s',
    async (configuredWorkspaceId) => {
      if (configuredWorkspaceId === undefined) {
        delete process.env.EXE_DEMO_WORKSPACE_ID;
      } else {
        process.env.EXE_DEMO_WORKSPACE_ID = configuredWorkspaceId;
      }
      const {
        loadDeletedWorkspaceMembersOnly,
        loadWorkspaceMembers,
        resolver,
      } = buildResolver({
        ownerUserIds: ['owner-one', 'owner-two'],
      } as unknown as JSON);

      await expect(
        resolver.workspaceMembers(user, authUser, demoWorkspace),
      ).resolves.toEqual([]);
      await expect(
        resolver.deletedWorkspaceMembers(user, authUser, demoWorkspace),
      ).resolves.toEqual([]);
      expect(loadWorkspaceMembers).not.toHaveBeenCalled();
      expect(loadDeletedWorkspaceMembersOnly).not.toHaveBeenCalled();
    },
  );

  it('keeps a non-DEMO directory available when no marker is present', async () => {
    delete process.env.EXE_DEMO_WORKSPACE_ID;
    const { loadWorkspaceMembers, resolver } = buildResolver(null);

    await resolver.workspaceMembers(user, authUser, demoWorkspace);

    expect(loadWorkspaceMembers).toHaveBeenCalledWith(demoWorkspace, false);
  });
});
