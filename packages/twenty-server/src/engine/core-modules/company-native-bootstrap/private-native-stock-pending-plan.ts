import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { type DataSource } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import {
  PrivateNativeMutationFence,
  type OriginalPrivateNativeWorkspace,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export type StockPendingNativePlan = Readonly<{
  original: OriginalPrivateNativeWorkspace;
  workspace: Readonly<WorkspaceEntity>;
  subjectUser: Readonly<UserEntity>;
}>;

// A pending binding snapshot is not a setup credential or stock-phase authority.
// The later provisioner must independently admit the isolated DB and its role.
export async function readStockPendingNativePlan(
  fence: PrivateNativeMutationFence,
  nativeDatabase: DataSource,
): Promise<StockPendingNativePlan> {
  PrivateNativeMutationFence.assertIssued(fence);
  await fence.assertCurrent();
  await fence.assertOriginalNativeDatabase(nativeDatabase);
  const original = await fence.readOriginalWorkspace();
  await fence.assertCurrent();

  const workspace = await nativeDatabase
    .getRepository(WorkspaceEntity)
    .findOneBy({ id: original.workspaceId });
  await fence.assertCurrent();
  if (
    !workspace ||
    workspace.id !== original.workspaceId ||
    workspace.activationStatus !== WorkspaceActivationStatus.PENDING_CREATION ||
    workspace.databaseSchema !== null ||
    workspace.workspaceCustomApplicationId !== original.customApplicationId ||
    workspace.deletedAt !== null ||
    workspace.suspendedAt !== null
  ) {
    throw new PrivateNativeActionUnavailable();
  }

  const subjectUser = await nativeDatabase
    .getRepository(UserEntity)
    .findOneBy({ id: original.userId });
  await fence.assertCurrent();
  if (
    !subjectUser ||
    subjectUser.id !== original.userId ||
    subjectUser.email !== `subject-${original.ownerSubject}@native.invalid` ||
    subjectUser.deletedAt !== null ||
    subjectUser.disabled !== false ||
    subjectUser.isEmailVerified !== false ||
    subjectUser.passwordHash !== null ||
    subjectUser.canImpersonate !== false ||
    subjectUser.canAccessFullAdminPanel !== false
  ) {
    throw new PrivateNativeActionUnavailable();
  }

  const membership = await nativeDatabase
    .getRepository(UserWorkspaceEntity)
    .findOneBy({ id: original.userWorkspaceId });
  await fence.assertCurrent();
  if (
    !membership ||
    membership.id !== original.userWorkspaceId ||
    membership.workspaceId !== original.workspaceId ||
    membership.userId !== original.userId ||
    membership.deletedAt !== null
  ) {
    throw new PrivateNativeActionUnavailable();
  }

  const application = await nativeDatabase
    .getRepository(ApplicationEntity)
    .findOneBy({ id: original.customApplicationId });
  await fence.assertCurrent();
  if (
    !application ||
    application.id !== original.customApplicationId ||
    application.workspaceId !== original.workspaceId ||
    application.universalIdentifier !== original.customApplicationId ||
    application.deletedAt !== null
  ) {
    throw new PrivateNativeActionUnavailable();
  }

  await fence.assertWorkspaceCurrent(original.workspaceId);
  return Object.freeze({
    original,
    workspace: Object.freeze({ ...workspace }),
    subjectUser: Object.freeze({ ...subjectUser }),
  });
}
