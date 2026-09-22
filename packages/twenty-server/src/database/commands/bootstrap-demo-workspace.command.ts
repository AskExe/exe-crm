import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Command, CommandRunner, Option } from 'nest-commander';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { IsNull, Repository } from 'typeorm';

import {
  KeyValuePairEntity,
  KeyValuePairType,
} from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';
import {
  WorkflowStatus,
  type WorkflowWorkspaceEntity,
} from 'src/modules/workflow/common/standard-objects/workflow.workspace-entity';

const DEMO_WORKSPACE_NAME = 'DEMO';
const DEMO_BOOTSTRAP_MARKER_KEY = 'exe.demo-workspace-bootstrap.v1';

type BootstrapDemoWorkspaceOptions = {
  execute?: boolean;
  owner?: string[];
};

type OwnerIdentity = { userId: string; email: string };

@Command({
  name: 'workspace:bootstrap:demo',
  description: 'Idempotently provision the isolated synthetic DEMO workspace',
})
export class BootstrapDemoWorkspaceCommand extends CommandRunner {
  private readonly logger = new Logger(BootstrapDemoWorkspaceCommand.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(KeyValuePairEntity)
    private readonly keyValuePairRepository: Repository<KeyValuePairEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly userRoleService: UserRoleService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {
    super();
  }

  @Option({
    flags: '--execute',
    description: 'Apply changes. Omit for a read-only plan.',
  })
  parseExecute(): boolean {
    return true;
  }

  @Option({
    flags: '--owner <user-id:email>',
    description: 'Verified existing CRM owner identity; provide exactly twice',
  })
  collectOwner(value: string, previous: string[] = []): string[] {
    return [...previous, value];
  }

  async run(
    _passedParams: string[],
    options: BootstrapDemoWorkspaceOptions,
  ): Promise<void> {
    const owners = this.parseOwners(options.owner ?? []);
    const users = await this.loadVerifiedOwners(owners);
    const existingDemo = await this.workspaceRepository.findOne({
      where: { displayName: DEMO_WORKSPACE_NAME },
      withDeleted: true,
    });

    if (!options.execute) {
      this.logger.log(
        JSON.stringify({
          mode: 'dry-run',
          action: existingDemo ? 'reconcile' : 'create',
          workspaceId: existingDemo?.id ?? null,
          ownerUserIds: users.map(({ id }) => id),
        }),
      );
      return;
    }

    const workspace = existingDemo
      ? await this.assertManagedDemo(existingDemo)
      : await this.createDemo(users[0]);

    try {
      const adminRole = await this.roleRepository.findOneByOrFail({
        workspaceId: workspace.id,
        universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
      });

      for (const user of users) {
        await this.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(
          user,
          workspace,
          adminRole.id,
        );
        const userWorkspace =
          await this.userWorkspaceService.checkUserWorkspaceExists(
            user.id,
            workspace.id,
          );
        if (!userWorkspace) {
          throw new Error(`Owner membership missing for user ${user.id}`);
        }
        await this.userRoleService.assignRoleToManyUserWorkspace({
          workspaceId: workspace.id,
          userWorkspaceIds: [userWorkspace.id],
          roleId: adminRole.id,
        });
      }

      await this.workspaceRepository.update(workspace.id, {
        isPublicInviteLinkEnabled: false,
      });
    } catch (error) {
      if (!existingDemo) {
        await this.workspaceService.deleteWorkspace(workspace.id);
      }
      throw error;
    }

    this.logger.log(
      JSON.stringify({
        mode: 'execute',
        action: existingDemo ? 'reconciled' : 'created',
        workspaceId: workspace.id,
        ownerUserIds: users.map(({ id }) => id),
        role: 'Admin',
      }),
    );
  }

  private parseOwners(values: string[]): OwnerIdentity[] {
    if (values.length !== 2) {
      throw new Error('Exactly two --owner values are required');
    }

    const owners = values.map((value) => {
      const separator = value.indexOf(':');
      if (separator < 1) throw new Error('Owner must use user-id:email');
      return {
        userId: value.slice(0, separator),
        email: value
          .slice(separator + 1)
          .trim()
          .toLowerCase(),
      };
    });

    if (new Set(owners.map(({ userId }) => userId)).size !== 2) {
      throw new Error('Owner user IDs must be distinct');
    }
    return owners;
  }

  private async loadVerifiedOwners(owners: OwnerIdentity[]) {
    return await Promise.all(
      owners.map(async ({ userId, email }) => {
        const user = await this.userRepository.findOneByOrFail({ id: userId });
        if (
          !user.isEmailVerified ||
          user.disabled ||
          user.email.toLowerCase() !== email
        ) {
          throw new Error(
            `Owner identity validation failed for user ${userId}`,
          );
        }
        return user;
      }),
    );
  }

  private async assertManagedDemo(workspace: WorkspaceEntity) {
    const marker = await this.keyValuePairRepository.findOneBy({
      workspaceId: workspace.id,
      userId: IsNull(),
      key: DEMO_BOOTSTRAP_MARKER_KEY,
    });
    if (
      !marker ||
      workspace.activationStatus !== WorkspaceActivationStatus.ACTIVE
    ) {
      throw new Error(
        'DEMO name collision: workspace lacks the operator bootstrap marker',
      );
    }
    return workspace;
  }

  private async createDemo(primaryOwner: UserEntity) {
    // The operator command supplies the authorization boundary. The in-memory
    // admin flag selects the canonical creation path without changing the user.
    const { workspace } = await this.signInUpService.signUpOnNewWorkspace({
      type: 'existingUser',
      existingUser: { ...primaryOwner, canAccessFullAdminPanel: true },
    });

    const activatedWorkspace = await this.workspaceService.activateWorkspace(
      fromUserEntityToFlat(primaryOwner),
      workspace,
      { displayName: DEMO_WORKSPACE_NAME },
    );
    if (!activatedWorkspace)
      throw new Error('DEMO activation did not return a workspace');

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const workflowRepository =
        await this.globalWorkspaceOrmManager.getRepository<WorkflowWorkspaceEntity>(
          activatedWorkspace.id,
          'workflow',
          { shouldBypassPermissionChecks: true },
        );
      await workflowRepository.update(
        {},
        {
          statuses: [WorkflowStatus.DEACTIVATED],
        },
      );
    }, buildSystemAuthContext(activatedWorkspace.id));

    await this.keyValuePairRepository.insert({
      workspaceId: activatedWorkspace.id,
      userId: null,
      key: DEMO_BOOTSTRAP_MARKER_KEY,
      type: KeyValuePairType.CONFIG_VARIABLE,
      textValueDeprecated: null,
      deletedAt: null,
    });
    return activatedWorkspace;
  }
}
