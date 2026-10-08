import { StockWorkspaceMemberCreationService } from 'src/engine/core-modules/user-workspace/stock-workspace-member-creation.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

const workspaceId = '123e4567-e89b-42d3-a456-426614174000';
const user = {
  id: '123e4567-e89b-42d3-a456-426614174001',
  firstName: 'Original',
  lastName: 'Subject',
  email: 'subject@native.invalid',
  locale: 'en' as const,
};

function harness() {
  const insert = jest.fn().mockResolvedValue(undefined);
  const find = jest.fn().mockResolvedValue([{ id: 'native-member' }]);
  const userWorkspaceRepository = {
    findOneOrFail: jest
      .fn()
      .mockResolvedValue({ defaultAvatarUrl: 'original-avatar' }),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (operation: () => Promise<void>) =>
      operation(),
    ),
    getRepository: jest.fn().mockResolvedValue({ insert, find }),
  };
  const service = new StockWorkspaceMemberCreationService(
    userWorkspaceRepository as never,
    globalWorkspaceOrmManager as never,
  );
  return {
    service,
    insert,
    find,
    userWorkspaceRepository,
    globalWorkspaceOrmManager,
  };
}

describe('shared stock workspace member creation', () => {
  it('keeps the exact stock native context, membership lookup and inserted subject fields', async () => {
    const h = harness();
    await h.service.createWorkspaceMember(workspaceId, user);
    expect(
      h.globalWorkspaceOrmManager.executeInWorkspaceContext,
    ).toHaveBeenCalledWith(
      expect.any(Function),
      buildSystemAuthContext(workspaceId),
    );
    expect(h.globalWorkspaceOrmManager.getRepository).toHaveBeenCalledWith(
      workspaceId,
      'workspaceMember',
      { shouldBypassPermissionChecks: true },
    );
    expect(h.userWorkspaceRepository.findOneOrFail).toHaveBeenCalledWith({
      where: { userId: user.id, workspaceId },
    });
    expect(h.insert).toHaveBeenCalledWith({
      name: { firstName: 'Original', lastName: 'Subject' },
      colorScheme: 'System',
      userId: user.id,
      userEmail: user.email,
      avatarUrl: 'original-avatar',
      locale: 'en',
    });
    expect(h.find).toHaveBeenCalledWith({ where: { userId: user.id } });
  });
  it('does not insert after the original UserWorkspace lookup refuses', async () => {
    const h = harness();
    const primary = new Error('missing original membership');
    h.userWorkspaceRepository.findOneOrFail.mockRejectedValue(primary);
    await expect(
      h.service.createWorkspaceMember(workspaceId, user),
    ).rejects.toBe(primary);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.find).not.toHaveBeenCalled();
  });
  it('preserves an insert failure and does not publish a later member result', async () => {
    const h = harness();
    const primary = new Error('native insert refused');
    h.insert.mockRejectedValue(primary);
    await expect(
      h.service.createWorkspaceMember(workspaceId, user),
    ).rejects.toBe(primary);
    expect(h.find).not.toHaveBeenCalled();
  });
  it.each([{ members: [] }, { members: [{ id: 'one' }, { id: 'two' }] }])(
    'retains the original exactly-one native member assertion',
    async ({ members }) => {
      const h = harness();
      h.find.mockResolvedValue(members);
      await expect(
        h.service.createWorkspaceMember(workspaceId, user),
      ).rejects.toThrow('Error while creating workspace member');
    },
  );
  it('keeps the ordinary UserWorkspaceService entry on the same operation', async () => {
    const h = harness();
    await UserWorkspaceService.prototype.createWorkspaceMember.call(
      {
        userWorkspaceRepository: h.userWorkspaceRepository,
        globalWorkspaceOrmManager: h.globalWorkspaceOrmManager,
      } as never,
      workspaceId,
      user,
    );
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.userWorkspaceRepository.findOneOrFail).toHaveBeenCalledWith({
      where: { userId: user.id, workspaceId },
    });
  });
});
