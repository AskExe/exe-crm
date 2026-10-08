import { StockUserWorkspaceRemovalService } from 'src/engine/core-modules/user-workspace/stock-user-workspace-removal.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';

describe('stock membership removal', () => {
  const membershipId = '123e4567-e89b-42d3-a456-426614174001';
  function setup() {
    const order: string[] = [];
    const userWorkspaceRepository = {
      delete: jest.fn(async () => {
        order.push('membership-hard');
        return { raw: [], generatedMaps: [], affected: 1 };
      }),
      softDelete: jest.fn(async () => {
        order.push('membership-soft');
        return { raw: [], generatedMaps: [], affected: 1 };
      }),
    };
    const roleTargetRepository = {
      delete: jest.fn(async () => {
        order.push('role-hard');
        return { raw: [], generatedMaps: [], affected: 1 };
      }),
      softRemove: jest.fn().mockImplementation(async () => {
        order.push('role-soft');
        return { userWorkspaceId: membershipId };
      }),
    };
    return {
      order,
      userWorkspaceRepository,
      roleTargetRepository,
      service: new StockUserWorkspaceRemovalService(
        userWorkspaceRepository,
        roleTargetRepository,
      ),
    };
  }
  it('removes the exact membership role targets before hard deletion by default', async () => {
    const item = setup();
    await item.service.deleteUserWorkspace({ userWorkspaceId: membershipId });
    expect(item.order).toEqual(['role-hard', 'membership-hard']);
    expect(item.roleTargetRepository.delete).toHaveBeenCalledWith({
      userWorkspaceId: membershipId,
    });
    expect(item.userWorkspaceRepository.delete).toHaveBeenCalledWith({
      id: membershipId,
    });
    expect(item.roleTargetRepository.softRemove).not.toHaveBeenCalled();
  });
  it('preserves native soft-removal order and selectors', async () => {
    const item = setup();
    await item.service.deleteUserWorkspace({
      userWorkspaceId: membershipId,
      softDelete: true,
    });
    expect(item.order).toEqual(['role-soft', 'membership-soft']);
    expect(item.roleTargetRepository.softRemove).toHaveBeenCalledWith({
      userWorkspaceId: membershipId,
    });
    expect(item.userWorkspaceRepository.softDelete).toHaveBeenCalledWith({
      id: membershipId,
    });
  });
  it('retains primary role-removal failure and never deletes the membership afterward', async () => {
    const item = setup();
    const primary = new Error('controlled');
    item.roleTargetRepository.delete.mockRejectedValue(primary);
    await expect(
      item.service.deleteUserWorkspace({ userWorkspaceId: membershipId }),
    ).rejects.toBe(primary);
    expect(item.userWorkspaceRepository.delete).not.toHaveBeenCalled();
  });
  it('keeps the ordinary service on the same stock membership removal', async () => {
    const item = setup();
    await Reflect.apply(
      UserWorkspaceService.prototype.deleteUserWorkspace,
      item,
      [{ userWorkspaceId: membershipId }],
    );
    expect(item.order).toEqual(['role-hard', 'membership-hard']);
  });
});
