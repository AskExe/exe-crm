import { type INestApplicationContext } from '@nestjs/common';

import { type DataSource } from 'typeorm';
import { v5 } from 'uuid';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { assertPrivateStockProviderContext } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-provider-context';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import {
  OnboardingStepKeys,
  type OnboardingKeyValueTypeMap,
} from 'src/engine/core-modules/onboarding/onboarding.service';
import { StockUserWorkspaceRemovalService } from 'src/engine/core-modules/user-workspace/stock-user-workspace-removal.service';
import { StockWorkspaceMemberCreationService } from 'src/engine/core-modules/user-workspace/stock-workspace-member-creation.service';
import { StockUserSoftDeletionService } from 'src/engine/core-modules/user/services/stock-user-soft-deletion.service';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

// Cold setup has no verified parent or writer grant. The original subject gets
// a native Guest role; the separate current-authority final coordinator must
// establish any writer capability. Setup identity is never the subject.
export async function completeOriginalStockSubjectAndRemoveSetup(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
  control: PrivateNativeStockRoleGuard,
  context: INestApplicationContext,
): Promise<void> {
  assertPrivateStockProviderContext(context, checkpoint, database);
  await control.assertBusinessDatabase(database, checkpoint);
  const original = checkpoint.pendingPlan.original;
  const user = await database
    .getRepository(UserEntity)
    .findOneByOrFail({ id: original.userId });
  await checkpoint.assertCurrent();
  if (
    user.disabled ||
    user.deletedAt ||
    user.isEmailVerified ||
    user.passwordHash ||
    user.canImpersonate ||
    user.canAccessFullAdminPanel ||
    user.email !== `subject-${original.ownerSubject}@native.invalid`
  )
    throw new PrivateNativeActionUnavailable();
  await context
    .get(StockWorkspaceMemberCreationService)
    .createWorkspaceMember(original.workspaceId, user);
  await checkpoint.assertCurrent();
  const applications = await context
    .get(ApplicationService)
    .findWorkspaceTwentyStandardAndCustomApplicationOrThrow({
      workspaceId: original.workspaceId,
    });
  await checkpoint.assertCurrent();
  if (
    applications.workspaceCustomFlatApplication.id !==
    original.customApplicationId
  )
    throw new PrivateNativeActionUnavailable();
  const guest = await context.get(RoleService).createGuestRole({
    workspaceId: original.workspaceId,
    ownerFlatApplication: applications.workspaceCustomFlatApplication,
  });
  await checkpoint.assertCurrent();
  await context.get(UserRoleService).assignRoleToManyUserWorkspace({
    workspaceId: original.workspaceId,
    userWorkspaceIds: [original.userWorkspaceId],
    roleId: guest.id,
  });
  await checkpoint.assertCurrent();
  // Same supported deletion used by OnboardingService's value=false operations;
  // no direct keyValuePair writes or manual native ACTIVE/schema mutation.
  const vars =
    context.get<UserVarsService<OnboardingKeyValueTypeMap>>(UserVarsService);
  await vars.delete({
    workspaceId: original.workspaceId,
    key: OnboardingStepKeys.ONBOARDING_INVITE_TEAM_PENDING,
  });
  await checkpoint.assertCurrent();
  for (const key of [
    OnboardingStepKeys.ONBOARDING_CONNECT_ACCOUNT_PENDING,
    OnboardingStepKeys.ONBOARDING_CREATE_PROFILE_PENDING,
  ]) {
    await vars.delete({
      userId: original.userId,
      workspaceId: original.workspaceId,
      key,
    });
    await checkpoint.assertCurrent();
  }
  const setupUserId = v5(
    'private-native-stock-setup-user-v1',
    original.actionId,
  );
  const setupMembershipId = v5(
    'private-native-stock-setup-membership-v1',
    original.actionId,
  );
  const orm = context.get(GlobalWorkspaceOrmManager);
  await orm.executeInWorkspaceContext(async () => {
    await checkpoint.assertCurrent();
    const members = await orm.getRepository<WorkspaceMemberWorkspaceEntity>(
      original.workspaceId,
      'workspaceMember',
      { shouldBypassPermissionChecks: true },
    );
    await checkpoint.assertCurrent();
    await members.delete({ userId: setupUserId });
    await checkpoint.assertCurrent();
  }, buildSystemAuthContext(original.workspaceId));
  await checkpoint.assertCurrent();
  await context
    .get(StockUserWorkspaceRemovalService)
    .deleteUserWorkspace({ userWorkspaceId: setupMembershipId });
  await checkpoint.assertCurrent();
  const deleted = await context
    .get(StockUserSoftDeletionService)
    .softDeleteUser(setupUserId);
  await checkpoint.assertCurrent();
  if (
    !deleted ||
    deleted.id !== setupUserId ||
    !deleted.disabled ||
    !deleted.deletedAt ||
    deleted.isEmailVerified ||
    deleted.passwordHash ||
    deleted.canImpersonate ||
    deleted.canAccessFullAdminPanel
  )
    throw new PrivateNativeActionUnavailable();
}
