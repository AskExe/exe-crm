import { StockUserSoftDeletionService } from 'src/engine/core-modules/user/services/stock-user-soft-deletion.service';
import { UserService } from 'src/engine/core-modules/user/services/user.service';

function harness() {
  const user = {
    id: 'derived-setup-user',
    deletedAt: new Date(),
    userWorkspaces: [],
  };
  const repository = {
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue(user),
  };
  const cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
  return {
    user,
    repository,
    cache,
    service: new StockUserSoftDeletionService(
      repository as never,
      cache as never,
    ),
  };
}

describe('stock native user soft deletion', () => {
  it('preserves native delete, cache invalidation and deleted-row read order', async () => {
    const h = harness();
    expect(await h.service.softDeleteUser(h.user.id)).toBe(h.user);
    expect(h.repository.softDelete).toHaveBeenCalledWith({ id: h.user.id });
    expect(h.cache.invalidate).toHaveBeenCalledWith('user', h.user.id);
    expect(h.repository.findOne).toHaveBeenCalledWith({
      where: { id: h.user.id },
      withDeleted: true,
    });
    expect(h.repository.softDelete.mock.invocationCallOrder[0]).toBeLessThan(
      h.cache.invalidate.mock.invocationCallOrder[0],
    );
    expect(h.cache.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      h.repository.findOne.mock.invocationCallOrder[0],
    );
  });
  it('retains primary deletion failure without cache or later publication', async () => {
    const h = harness();
    const primary = new Error('inert deletion failure');
    h.repository.softDelete.mockRejectedValueOnce(primary);
    await expect(h.service.softDeleteUser(h.user.id)).rejects.toBe(primary);
    expect(h.cache.invalidate).not.toHaveBeenCalled();
    expect(h.repository.findOne).not.toHaveBeenCalled();
  });
  it('propagates cache failure without claiming the completed delete was rolled back', async () => {
    const h = harness();
    const primary = new Error('inert cache failure');
    h.cache.invalidate.mockRejectedValueOnce(primary);
    await expect(h.service.softDeleteUser(h.user.id)).rejects.toBe(primary);
    expect(h.repository.softDelete).toHaveBeenCalledTimes(1);
    expect(h.repository.findOne).not.toHaveBeenCalled();
  });
  it('keeps ordinary UserService membership handling before the shared final deletion', async () => {
    const h = harness();
    const membership = { id: 'ordinary-membership' };
    h.repository.findOne.mockResolvedValueOnce({
      ...h.user,
      userWorkspaces: [membership],
    });
    const remove = jest.fn().mockResolvedValue(undefined);
    const ordinary = Object.assign(Object.create(UserService.prototype), {
      userRepository: h.repository,
      coreEntityCacheService: h.cache,
      removeUserFromWorkspaceAndPotentiallyDeleteWorkspace: remove,
    }) as UserService;
    expect(await ordinary.deleteUser(h.user.id)).toBe(h.user);
    expect(remove).toHaveBeenCalledWith(membership);
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      h.repository.softDelete.mock.invocationCallOrder[0],
    );
  });
});
