import { type DataSource } from 'typeorm';
import { v5 } from 'uuid';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { fencePrivateStockQueryRunner } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-query-fence';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';

export type PrivateStockSetupIdentity = Readonly<{
  userId: string;
  userWorkspaceId: string;
  workspaceId: string;
}>;

export class PrivateNativeStockSetupUncertain extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private native stock setup requires reconciliation');
  }
}

// No native login, token, workspaceMember, verified subject or admin-console
// capability is created. Stock init may assign its setup-only admin RoleTarget.
export async function createPrivateStockSetupIdentity(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
  stockControl?: PrivateNativeStockRoleGuard,
): Promise<PrivateStockSetupIdentity> {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  const guard =
    stockControl ?? new PrivateNativeStockRoleGuard(database, checkpoint);
  await guard.assertFresh(stockControl ? database : undefined);
  const original = checkpoint.pendingPlan.original;
  const identity = Object.freeze({
    userId: v5('private-native-stock-setup-user-v1', original.actionId),
    userWorkspaceId: v5(
      'private-native-stock-setup-membership-v1',
      original.actionId,
    ),
    workspaceId: original.workspaceId,
  });
  const runner = database.createQueryRunner();
  let first: unknown;
  const cleanupErrors: unknown[] = [];
  let commitAttempted = false;
  try {
    await fencePrivateStockQueryRunner(
      database,
      runner,
      checkpoint,
      stockControl,
    );
    await runner.connect();
    await guard.assertCurrent();
    await runner.startTransaction();
    await guard.assertCurrent();
    const created: unknown = await runner.query(
      `INSERT INTO core."user" (id,email,"firstName","lastName",disabled,"isEmailVerified",
       "passwordHash","canImpersonate","canAccessFullAdminPanel")
       VALUES ($1::uuid,$2,'Native setup','',true,false,NULL,false,false)
       RETURNING id,disabled,"isEmailVerified","passwordHash","canImpersonate","canAccessFullAdminPanel"`,
      [identity.userId, `setup-${identity.userId}@native.invalid`],
    );
    await guard.assertCurrent();
    if (
      !Array.isArray(created) ||
      created.length !== 1 ||
      created[0].id !== identity.userId ||
      created[0].disabled !== true ||
      created[0].isEmailVerified !== false ||
      created[0].passwordHash !== null ||
      created[0].canImpersonate !== false ||
      created[0].canAccessFullAdminPanel !== false
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    await guard.assertCurrent();
    const membership: unknown = await runner.query(
      `INSERT INTO core."userWorkspace" (id,"userId","workspaceId")
       VALUES ($1::uuid,$2::uuid,$3::uuid) RETURNING id,"userId","workspaceId"`,
      [identity.userWorkspaceId, identity.userId, identity.workspaceId],
    );
    await guard.assertCurrent();
    if (
      !Array.isArray(membership) ||
      membership.length !== 1 ||
      membership[0].id !== identity.userWorkspaceId ||
      membership[0].userId !== identity.userId ||
      membership[0].workspaceId !== identity.workspaceId
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    await guard.assertCurrent();
    commitAttempted = true;
    await runner.commitTransaction();
    await guard.assertCurrent();
  } catch (error) {
    first = error;
    if (!commitAttempted && runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  } finally {
    try {
      await runner.release();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (first || cleanupErrors.length) {
    // A lost/late commit ACK is never retried or compensated with deletions.
    throw new PrivateNativeStockSetupUncertain(
      first ?? new PrivateNativeActionUnavailable(),
      Object.freeze(cleanupErrors),
    );
  }
  try {
    await checkpoint.assertCurrent();
  } catch (error) {
    throw new PrivateNativeStockSetupUncertain(error, Object.freeze([]));
  }
  return identity;
}
