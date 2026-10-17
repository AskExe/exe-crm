import { performance } from 'node:perf_hooks';

import { type DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
  snapshotPrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';

// Concrete SQL-owned fence, not a caller-supplied checkpoint callback.
export class PrivateNativeMutationFence {
  private constructor(
    private readonly reader: PrivateNativeActionReader,
    private readonly tuple: Readonly<PrivateNativeActionTuple>,
    private readonly ownerSubject: string,
    private readonly workDeadline: number,
    private readonly originalLeaseDeadline: number,
    private readonly reserveMilliseconds: number,
    private readonly nativeGuard: PrivateNativeDatabaseGuard,
  ) {}

  static async bindCommittedMarker(
    nativeDatabase: DataSource,
    reader: PrivateNativeActionReader,
    input: PrivateNativeActionTuple,
    ownerSubject: string,
    workDeadline: number,
    originalLeaseDeadline: number,
    reserveMilliseconds: number,
    nativeRole: string,
  ): Promise<PrivateNativeMutationFence> {
    const tuple = snapshotPrivateNativeActionTuple(input);
    if (
      ![workDeadline, originalLeaseDeadline, reserveMilliseconds].every(
        Number.isFinite,
      ) ||
      reserveMilliseconds < 60000
    )
      throw new PrivateNativeActionUnavailable();
    const fence = new PrivateNativeMutationFence(
      reader,
      tuple,
      ownerSubject,
      workDeadline,
      originalLeaseDeadline,
      reserveMilliseconds,
      new PrivateNativeDatabaseGuard(nativeDatabase, nativeRole, false),
    );
    await fence.assertCurrent();
    const rows: unknown = await nativeDatabase.query(
      `SELECT "actionId"
      FROM core."privateNativeAction" WHERE "actionId"=$1 AND "intentId"=$2
      AND "jobId"=$3 AND "companyId"=$4 AND "deploymentId"=$5 AND "requestKey"=$6
      AND "ownerSubject"=$7 AND "attempt"=$8 AND "workerId"=$9
      AND "profileSha256"=$10 AND "configSha256"=$11 AND "initializerSha256"=$12`,
      [
        tuple.action_id,
        tuple.intent_id,
        tuple.job_id,
        tuple.company_id,
        tuple.deployment_id,
        tuple.request_key,
        ownerSubject,
        tuple.attempt,
        tuple.worker_id,
        tuple.profile_sha256,
        tuple.config_sha256,
        tuple.initializer_sha256,
      ],
    );
    fence.assertOriginalDeadline();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0].actionId !== tuple.action_id
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    await fence.assertCurrent();
    return fence;
  }

  assertOriginalDeadline(): void {
    const now = performance.now();
    if (
      now >= this.workDeadline ||
      now + this.reserveMilliseconds >= this.originalLeaseDeadline
    ) {
      throw new PrivateNativeActionUnavailable();
    }
  }

  async assertCurrent(): Promise<void> {
    this.assertOriginalDeadline();
    await this.nativeGuard.assertCurrent();
    this.assertOriginalDeadline();
    const current = await this.reader.read(
      this.tuple,
      Math.ceil(this.workDeadline - performance.now()) +
        this.reserveMilliseconds,
    );
    this.assertOriginalDeadline();
    if (
      current.monotonicDeadline <=
        this.workDeadline + this.reserveMilliseconds ||
      current.authority.owner_subject !== this.ownerSubject
    ) {
      throw new PrivateNativeActionUnavailable();
    }
  }
}
