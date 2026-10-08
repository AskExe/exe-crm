import { type Repository } from 'typeorm';

import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { type RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';

// The existing stock membership removal, without login/invitation providers.
// Private setup must derive and verify its setup membership before using it.
export class StockUserWorkspaceRemovalService {
  constructor(
    private readonly userWorkspaceRepository: Pick<
      Repository<UserWorkspaceEntity>,
      'softDelete' | 'delete'
    >,
    private readonly roleTargetRepository: Pick<
      Repository<RoleTargetEntity>,
      'softRemove' | 'delete'
    >,
  ) {}

  async deleteUserWorkspace({
    userWorkspaceId,
    softDelete = false,
  }: {
    userWorkspaceId: string;
    softDelete?: boolean;
  }): Promise<void> {
    if (softDelete) {
      await this.roleTargetRepository.softRemove({ userWorkspaceId });
      await this.userWorkspaceRepository.softDelete({ id: userWorkspaceId });
    } else {
      await this.roleTargetRepository.delete({ userWorkspaceId }); // TODO remove once userWorkspace foreign key is added on roleTarget
      await this.userWorkspaceRepository.delete({ id: userWorkspaceId });
    }
  }
}
