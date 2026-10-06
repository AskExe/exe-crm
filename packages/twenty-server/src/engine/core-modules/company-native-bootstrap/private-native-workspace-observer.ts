import { performance } from 'node:perf_hooks';

import { type DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
  snapshotPrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';

// Compile-time ES2018 shape only; calls still use Node's native constructor.
type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

// A separate read-only native connection, not an initializer return value.
// This observes only database identity. Image/storage/UID/quota qualification
// and ACTIVE native readiness require separate independently bound evidence.
export class PrivateNativeWorkspaceObserver {
  constructor(
    private readonly nativeReadDatabase: DataSource,
    private readonly independentAuthorityReader: PrivateNativeActionReader,
    private readonly packageSha256: string,
    private readonly nativeRole: string,
    private readonly enabled: boolean = false,
  ) {}

  async observe(input: PrivateNativeActionTuple) {
    if (!this.enabled || !/^[0-9a-f]{64}$/.test(this.packageSha256)) {
      throw new PrivateNativeActionUnavailable();
    }
    const tuple = snapshotPrivateNativeActionTuple(input);
    const workDeadline = performance.now() + 30000;
    const first = await this.independentAuthorityReader.read(tuple, 60001);
    const originalLeaseDeadline = first.monotonicDeadline;
    const assertOriginalDeadline = () => {
      const now = performance.now();
      if (now >= workDeadline || now + 30000 >= originalLeaseDeadline) {
        throw new PrivateNativeActionUnavailable();
      }
    };
    assertOriginalDeadline();
    const nativeGuard = new PrivateNativeDatabaseGuard(
      this.nativeReadDatabase,
      this.nativeRole,
      true,
    );
    const assertCurrent = async () => {
      assertOriginalDeadline();
      await nativeGuard.assertCurrent();
      assertOriginalDeadline();
      const current = await this.independentAuthorityReader.read(
        tuple,
        Math.ceil(workDeadline - performance.now()) + 30000,
      );
      assertOriginalDeadline();
      if (
        current.monotonicDeadline <= workDeadline + 30000 ||
        current.authority.owner_subject !== first.authority.owner_subject
      ) {
        throw new PrivateNativeActionUnavailable();
      }
    };
    await assertCurrent();
    const runner = this.nativeReadDatabase.createQueryRunner();
    let transactionStarted = false;
    let primary: unknown;
    try {
      await runner.connect();
      assertOriginalDeadline();
      await runner.startTransaction('REPEATABLE READ');
      transactionStarted = true;
      assertOriginalDeadline();
      await runner.query('SET TRANSACTION READ ONLY');
      await assertCurrent();
      const rows: unknown = await runner.query(
        `SELECT
        a."actionId", b."workspaceId", b."userId", b."userWorkspaceId",
        w."activationStatus", w."databaseSchema",
        u.email AS "nativeIdentifier", u."isEmailVerified" AS "nativeEmailVerified"
        FROM core."privateNativeAction" a
        JOIN core."privateNativeWorkspaceBinding" b ON b."actionId"=a."actionId"
        JOIN core.workspace w ON w.id=b."workspaceId"
        JOIN core."user" u ON u.id=b."userId"
        JOIN core."userWorkspace" uw ON uw.id=b."userWorkspaceId"
        WHERE a."actionId"=$1 AND a."intentId"=$2 AND a."jobId"=$3
          AND a."companyId"=$4 AND a."deploymentId"=$5 AND a."requestKey"=$6
          AND a."ownerSubject"=$7 AND a."attempt"=$8 AND a."workerId"=$9
          AND a."profileSha256"=$10 AND a."configSha256"=$11
          AND a."initializerSha256"=$12 AND a."packageSha256"=$13
          AND w."deletedAt" IS NULL AND w."suspendedAt" IS NULL
          AND u."deletedAt" IS NULL AND u.disabled=false
          AND u."isEmailVerified"=false AND u.email=$14
          AND u."passwordHash" IS NULL AND u."canImpersonate"=false
          AND u."canAccessFullAdminPanel"=false
          AND uw."deletedAt" IS NULL AND uw."workspaceId"=w.id AND uw."userId"=u.id`,
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
          `subject-${first.authority.owner_subject}@native.invalid`,
        ],
      );
      assertOriginalDeadline();
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0].nativeIdentifier !==
          `subject-${first.authority.owner_subject}@native.invalid` ||
        rows[0].nativeEmailVerified !== false
      ) {
        throw new PrivateNativeActionUnavailable();
      }
      await assertCurrent();
      await runner.commitTransaction();
      transactionStarted = false;
      await assertCurrent();
      const {
        nativeIdentifier: _identifier,
        nativeEmailVerified: _verified,
        ...observed
      } = rows[0];
      return Object.freeze({ ...observed, readiness: 'unverified' as const });
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
          'Private native observation unavailable',
        );
      }
    }
  }
}
