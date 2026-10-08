import { type APP_LOCALES, SOURCE_LOCALE } from 'twenty-shared/translations';
import { type Repository } from 'typeorm';

import { type UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';
import { assert } from 'src/utils/assert';

// The same stock member operation without unrelated login/invitation providers.
// It is not a principal issuer, and does not create User or UserWorkspace rows.
export class StockWorkspaceMemberCreationService {
  constructor(
    private readonly userWorkspaceRepository: Pick<
      Repository<UserWorkspaceEntity>,
      'findOneOrFail'
    >,
    private readonly globalWorkspaceOrmManager: Pick<
      GlobalWorkspaceOrmManager,
      'executeInWorkspaceContext' | 'getRepository'
    >,
  ) {}

  async createWorkspaceMember(
    workspaceId: string,
    user: Pick<
      UserEntity,
      'id' | 'firstName' | 'lastName' | 'email' | 'locale'
    >,
  ) {
    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const workspaceMemberRepository =
        await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
          workspaceId,
          'workspaceMember',
          { shouldBypassPermissionChecks: true },
        );

      const userWorkspace = await this.userWorkspaceRepository.findOneOrFail({
        where: {
          userId: user.id,
          workspaceId,
        },
      });

      await workspaceMemberRepository.insert({
        name: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        colorScheme: 'System',
        userId: user.id,
        userEmail: user.email,
        avatarUrl: userWorkspace.defaultAvatarUrl ?? '',
        locale: (user.locale ?? SOURCE_LOCALE) as keyof typeof APP_LOCALES,
      });

      const workspaceMember = await workspaceMemberRepository.find({
        where: {
          userId: user.id,
        },
      });

      assert(
        workspaceMember?.length === 1,
        `Error while creating workspace member ${user.email} on workspace ${workspaceId}`,
      );
    }, authContext);
  }
}
