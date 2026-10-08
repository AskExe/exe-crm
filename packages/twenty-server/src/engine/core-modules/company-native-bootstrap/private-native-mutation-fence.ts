import { performance } from 'node:perf_hooks';

import { type DataSource } from 'typeorm';
import { v5 } from 'uuid';

import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
  snapshotPrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

export type OriginalPrivateNativeWorkspace = Readonly<{
  actionId: string;
  workspaceId: string;
  userId: string;
  userWorkspaceId: string;
  customApplicationId: string;
  standardApplicationId: string;
  ownerSubject: string;
  schemaName: string;
}>;

const issuedFences = new WeakSet<PrivateNativeMutationFence>();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Concrete SQL-owned fence, not a caller-supplied checkpoint callback.
export class PrivateNativeMutationFence {
  private originalWorkspace?: OriginalPrivateNativeWorkspace;
  private constructor(
    private readonly reader: PrivateNativeActionReader,
    private readonly tuple: Readonly<PrivateNativeActionTuple>,
    private readonly ownerSubject: string,
    private readonly workDeadline: number,
    private readonly originalLeaseDeadline: number,
    private readonly reserveMilliseconds: number,
    private readonly nativeGuard: PrivateNativeDatabaseGuard,
    private readonly nativeDatabase: DataSource,
  ) {}

  static assertIssued(fence: PrivateNativeMutationFence): void {
    if (!issuedFences.has(fence)) throw new PrivateNativeActionUnavailable();
  }

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
      nativeDatabase,
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
    issuedFences.add(fence);
    return fence;
  }

  // Provisioning selectors come from the original committed marker/binding,
  // never from an initializer's workspace, subject or schema argument.
  async readOriginalWorkspace(): Promise<OriginalPrivateNativeWorkspace> {
    if (!issuedFences.has(this)) throw new PrivateNativeActionUnavailable();
    await this.assertCurrent();
    const rows: unknown = await this.nativeDatabase.query(
      `SELECT a."actionId",a."plannedWorkspaceId" AS "workspaceId",a."plannedUserId" AS "userId",
        a."plannedUserWorkspaceId" AS "userWorkspaceId",a."plannedApplicationId" AS "applicationId",a."ownerSubject",w."databaseSchema"
       FROM core."privateNativeAction" a
       JOIN core."privateNativeWorkspaceBinding" b ON b."actionId"=a."actionId"
       JOIN core.workspace w ON w.id=b."workspaceId" AND w.id=a."plannedWorkspaceId"
       JOIN core."user" u ON u.id=b."userId" AND u.id=a."plannedUserId"
       JOIN core."userWorkspace" uw ON uw.id=b."userWorkspaceId"
         AND uw.id=a."plannedUserWorkspaceId" AND uw."workspaceId"=w.id AND uw."userId"=u.id
       JOIN core.application app ON app.id=a."plannedApplicationId" AND app."workspaceId"=w.id
         AND w."workspaceCustomApplicationId"=app.id
         AND app."universalIdentifier"=app.id AND app."deletedAt" IS NULL
       WHERE a."actionId"=$1 AND a."intentId"=$2 AND a."jobId"=$3
         AND a."companyId"=$4 AND a."deploymentId"=$5 AND a."requestKey"=$6
         AND a."ownerSubject"=$7 AND a."attempt"=$8 AND a."workerId"=$9
         AND a."profileSha256"=$10 AND a."configSha256"=$11 AND a."initializerSha256"=$12
         AND w."activationStatus"='PENDING_CREATION' AND w."deletedAt" IS NULL
         AND w."suspendedAt" IS NULL AND u."deletedAt" IS NULL AND u.disabled=false
         AND u."passwordHash" IS NULL AND u."canImpersonate"=false
         AND u."canAccessFullAdminPanel"=false AND u."isEmailVerified"=false
         AND u.email=$13 AND uw."deletedAt" IS NULL`,
      [
        this.tuple.action_id,
        this.tuple.intent_id,
        this.tuple.job_id,
        this.tuple.company_id,
        this.tuple.deployment_id,
        this.tuple.request_key,
        this.ownerSubject,
        this.tuple.attempt,
        this.tuple.worker_id,
        this.tuple.profile_sha256,
        this.tuple.config_sha256,
        this.tuple.initializer_sha256,
        `subject-${this.ownerSubject}@native.invalid`,
      ],
    );
    await this.assertCurrent();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0] !== 'object' ||
      rows[0] === null
    )
      throw new PrivateNativeActionUnavailable();
    const row = rows[0];
    if (
      row.actionId !== this.tuple.action_id ||
      row.ownerSubject !== this.ownerSubject ||
      !['workspaceId', 'userId', 'userWorkspaceId', 'applicationId'].every(
        (key) => typeof row[key] === 'string' && UUID.test(row[key]),
      )
    )
      throw new PrivateNativeActionUnavailable();
    const schemaName = getWorkspaceSchemaName(row.workspaceId);
    if (row.databaseSchema !== null && row.databaseSchema !== schemaName)
      throw new PrivateNativeActionUnavailable();
    const original = Object.freeze({
      actionId: row.actionId,
      workspaceId: row.workspaceId,
      userId: row.userId,
      userWorkspaceId: row.userWorkspaceId,
      customApplicationId: row.applicationId,
      standardApplicationId: v5(
        'private-native-standard-application-v1',
        row.actionId,
      ),
      ownerSubject: this.ownerSubject,
      schemaName,
    });
    if (
      this.originalWorkspace &&
      Object.keys(original).some(
        (key) =>
          original[key as keyof OriginalPrivateNativeWorkspace] !==
          this.originalWorkspace?.[key as keyof OriginalPrivateNativeWorkspace],
      )
    )
      throw new PrivateNativeActionUnavailable();
    this.originalWorkspace ??= original;
    return original;
  }

  async assertOriginalNativeDatabase(database: DataSource): Promise<void> {
    await this.assertCurrent();
    const query = `SELECT inet_server_addr()::text AS address,
      inet_server_port() AS port,current_database() AS database`;
    const original: unknown = await this.nativeDatabase.query(query);
    await this.assertCurrent();
    const structural: unknown = await database.query(query);
    await this.assertCurrent();
    const endpoint = (value: unknown): string => {
      if (
        !Array.isArray(value) ||
        value.length !== 1 ||
        typeof value[0]?.address !== 'string' ||
        value[0].address.length > 64 ||
        !Number.isInteger(value[0].port) ||
        value[0].port < 1 ||
        value[0].port > 65535 ||
        typeof value[0].database !== 'string' ||
        value[0].database.length > 63
      )
        throw new PrivateNativeActionUnavailable();
      return JSON.stringify([
        value[0].address,
        value[0].port,
        value[0].database,
      ]);
    };
    if (endpoint(original) !== endpoint(structural))
      throw new PrivateNativeActionUnavailable();
  }

  async assertWorkspaceCurrent(workspaceId: string): Promise<void> {
    const original = await this.readOriginalWorkspace();
    if (workspaceId !== original.workspaceId)
      throw new PrivateNativeActionUnavailable();
  }

  remainingOriginalWorkMilliseconds(): number {
    PrivateNativeMutationFence.assertIssued(this);
    this.assertOriginalDeadline();
    return Math.floor(
      Math.min(
        this.workDeadline,
        this.originalLeaseDeadline - this.reserveMilliseconds,
      ) - performance.now(),
    );
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
