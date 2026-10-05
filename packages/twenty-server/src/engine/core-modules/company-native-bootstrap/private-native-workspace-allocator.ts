import { performance } from 'node:perf_hooks';

import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { type DataSource } from 'typeorm';
import { v4 } from 'uuid';

import { createTransactionalCustomApplication } from 'src/engine/core-modules/application/create-transactional-custom-application';
import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
  snapshotPrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { LocalDriver } from 'src/engine/core-modules/file-storage/drivers/local.driver';
import { ValidatedStorageDriver } from 'src/engine/core-modules/file-storage/drivers/validated-storage.driver';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export type PendingPrivateNativeWorkspace = Readonly<{
  actionId: string;
  workspaceId: string;
  userId: string;
  userWorkspaceId: string;
  activationStatus: WorkspaceActivationStatus.PENDING_CREATION;
}>;

const OBSERVER_RESERVE_MILLISECONDS = 30000;
const CLEANUP_RESERVE_MILLISECONDS = 30000;
const ADMISSION_MARGIN_MILLISECONDS = 1000;

// Deliberately not a Nest provider. Only the private one-shot composition may
// construct this with its native connection and ephemeral Core worker reader.
export class PrivateNativeWorkspaceAllocator {
  private consumed = false;

  constructor(
    private readonly nativeDatabase: DataSource,
    private readonly authorityReader: PrivateNativeActionReader,
    private readonly privateStorageRoot: string,
    private readonly packageSha256: string,
    private readonly nativeRole: string,
    private readonly enabled: boolean = false,
  ) {}

  async allocatePending(
    input: PrivateNativeActionTuple,
    remainingBudgetMilliseconds: number,
  ): Promise<PendingPrivateNativeWorkspace> {
    if (
      !this.enabled ||
      this.consumed ||
      !Number.isSafeInteger(remainingBudgetMilliseconds) ||
      remainingBudgetMilliseconds <= 0 ||
      !/^[0-9a-f]{64}$/.test(this.packageSha256)
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    this.consumed = true;
    const tuple = snapshotPrivateNativeActionTuple(input);
    const workDeadline = performance.now() + remainingBudgetMilliseconds;
    const reservedMilliseconds =
      OBSERVER_RESERVE_MILLISECONDS +
      CLEANUP_RESERVE_MILLISECONDS +
      ADMISSION_MARGIN_MILLISECONDS;
    const first = await this.authorityReader.read(
      tuple,
      remainingBudgetMilliseconds + reservedMilliseconds,
    );
    const originalLeaseDeadline = first.monotonicDeadline;
    const assertOriginalDeadline = () => {
      const now = performance.now();
      if (
        now >= workDeadline ||
        now + reservedMilliseconds >= originalLeaseDeadline
      ) {
        throw new PrivateNativeActionUnavailable();
      }
    };
    assertOriginalDeadline();
    const nativeGuard = new PrivateNativeDatabaseGuard(
      this.nativeDatabase,
      this.nativeRole,
      false,
    );
    const assertCurrent = async () => {
      assertOriginalDeadline();
      await nativeGuard.assertCurrent();
      assertOriginalDeadline();
      const latest = await this.authorityReader.read(
        tuple,
        Math.ceil(workDeadline - performance.now()) + reservedMilliseconds,
      );
      // A renewal cannot extend the original admitted work or lease deadline.
      assertOriginalDeadline();
      if (
        latest.monotonicDeadline <= workDeadline + reservedMilliseconds ||
        latest.authority.owner_subject !== first.authority.owner_subject
      ) {
        throw new PrivateNativeActionUnavailable();
      }
    };

    const workspaceId = v4();
    const userId = v4();
    const applicationId = v4();
    const membershipId = v4();
    await assertCurrent();

    assertOriginalDeadline();

    // Autocommit first-writer marker precedes every native allocation write.
    // Conflict, lost INSERT response or later failure must not invoke again.
    await this.nativeDatabase.query(
      `
      INSERT INTO core."privateNativeAction" (
        "actionId","intentId","jobId","companyId","deploymentId",
        "requestKey","ownerSubject","attempt","workerId",
        "profileSha256","configSha256","initializerSha256","packageSha256",
        "plannedWorkspaceId","plannedUserId","plannedUserWorkspaceId","plannedApplicationId"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `,
      [
        tuple.action_id,
        tuple.intent_id,
        tuple.job_id,
        tuple.company_id,
        tuple.deployment_id,
        tuple.request_key,
        first.authority.owner_subject,
        tuple.attempt,
        tuple.worker_id,
        tuple.profile_sha256,
        tuple.config_sha256,
        tuple.initializer_sha256,
        this.packageSha256,
        workspaceId,
        userId,
        membershipId,
        applicationId,
      ],
    );
    await assertCurrent();

    const privateFence = await PrivateNativeMutationFence.bindCommittedMarker(
      this.nativeDatabase,
      this.authorityReader,
      tuple,
      first.authority.owner_subject,
      workDeadline,
      originalLeaseDeadline,
      reservedMilliseconds,
      this.nativeRole,
    );
    assertOriginalDeadline();

    const runner = this.nativeDatabase.createQueryRunner();
    let transactionStarted = false;
    let primary: unknown;
    try {
      await runner.connect();
      await assertCurrent();
      await runner.startTransaction();
      transactionStarted = true;
      await runner.query('SELECT core.lock_private_native_empty($1::uuid)', [
        tuple.action_id,
      ]);
      await assertCurrent();
      const counts: unknown = await runner.query(`SELECT
        (SELECT count(*)::text FROM core.workspace) AS workspaces,
        (SELECT count(*)::text FROM core."user") AS users`);
      if (
        !Array.isArray(counts) ||
        counts.length !== 1 ||
        counts[0].workspaces !== '0' ||
        counts[0].users !== '0'
      ) {
        throw new PrivateNativeActionUnavailable();
      }
      await assertCurrent();
      assertOriginalDeadline();
      const workspace = await runner.manager.save(WorkspaceEntity, {
        id: workspaceId,
        workspaceCustomApplicationId: applicationId,
        subdomain: `private-${workspaceId}`,
        displayName: '',
        inviteHash: v4(),
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });
      await assertCurrent();
      assertOriginalDeadline();
      await createTransactionalCustomApplication(
        { workspaceId, applicationId },
        runner,
        new ValidatedStorageDriver(
          new LocalDriver(
            { storagePath: this.privateStorageRoot },
            privateFence,
          ),
        ),
        privateFence,
      );
      await assertCurrent();
      assertOriginalDeadline();
      // A private native identifier is not an adopted email identity. No
      // password, server-admin grant, email-verification claim or signup event.
      await runner.manager.save(UserEntity, {
        id: userId,
        email: `subject-${first.authority.owner_subject}@native.invalid`,
        isEmailVerified: false,
        canImpersonate: false,
        canAccessFullAdminPanel: false,
        disabled: false,
        firstName: '',
        lastName: '',
      });
      await assertCurrent();
      assertOriginalDeadline();
      // The existing create(new user, no picture) path saves this same entity
      // without avatar IO. Pin its UUID before any external package write.
      const membership = await runner.manager.save(UserWorkspaceEntity, {
        id: membershipId,
        userId,
        workspaceId,
      });
      await assertCurrent();
      assertOriginalDeadline();
      await runner.query(
        `INSERT INTO core."privateNativeWorkspaceBinding"
        ("actionId","workspaceId","userId","userWorkspaceId")
        VALUES ($1,$2,$3,$4)`,
        [tuple.action_id, workspace.id, userId, membership.id],
      );
      await assertCurrent();
      assertOriginalDeadline();
      await runner.commitTransaction();
      transactionStarted = false;
      // Failed acknowledgement/currentness after commit is quarantined; the
      // durable marker/binding must be inspected, never replaced or retried.
      await assertCurrent();
      return Object.freeze({
        actionId: tuple.action_id,
        workspaceId: workspace.id,
        userId,
        userWorkspaceId: membership.id,
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      });
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      const secondary: unknown[] = [];
      if (transactionStarted) {
        try {
          await runner.rollbackTransaction();
        } catch (error) {
          secondary.push(error);
        }
      }
      try {
        await runner.release();
      } catch (error) {
        secondary.push(error);
      }
      if (secondary.length) {
        throw new AggregateError(
          primary === undefined ? secondary : [primary, ...secondary],
          'Private native allocation requires reconciliation',
        );
      }
    }
  }
}
