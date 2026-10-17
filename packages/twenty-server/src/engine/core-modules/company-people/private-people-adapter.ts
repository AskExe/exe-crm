import { randomUUID } from 'node:crypto';

import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';

import { type DataSource } from 'typeorm';
import { FieldActorSource } from 'twenty-shared/types';

import { type CompanyAuthConfiguration } from 'src/engine/core-modules/company-auth/company-auth.config';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceQueryRunner } from 'src/engine/twenty-orm/query-runner/workspace-query-runner';
import { PrivateInsertEvents } from 'src/engine/twenty-orm/repository/private-insert-events';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

import {
  capturePrivatePeople,
  type PrivatePeopleDeadline,
  type PrivatePeopleSource,
} from './private-people-contract';
import { assertPrivatePeopleDatabaseRole } from './private-people-database-guard';
import { readPrivatePeopleIdentity } from './private-people-identity';

const endpoint = (dataSource: DataSource) => {
  const options = dataSource.options;
  if (
    options.type !== 'postgres' ||
    typeof options.url !== 'string' ||
    options.host !== undefined ||
    options.port !== undefined ||
    options.database !== undefined
  )
    throw new Error('Private people database binding unavailable');
  const url = new URL(options.url);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.search ||
    url.hash
  )
    throw new Error('Private people database binding unavailable');
  // Credentials stay private and are not part of any receipt or error body.
  return JSON.stringify([url.hostname, url.port || '5432', url.pathname]);
};

type Composition = {
  enabled: boolean;
  configuration: CompanyAuthConfiguration;
  core: DataSource;
  orm: GlobalWorkspaceOrmManager;
  cache: WorkspaceCacheService;
  emitter: WorkspaceEventEmitter;
};

export class PrivatePeopleUncertain extends Error {
  constructor(readonly primary: unknown) {
    super('Private people outcome uncertain');
  }
}

// No Nest provider/module/route is registered. Only the trusted private Core
// composition may construct this adapter; its default is disabled.
export class PrivatePeopleAdapter {
  private readonly composition: Composition;

  constructor(composition: Composition) {
    // Copy the already operator-authenticated mapping; later mutation of a
    // caller-held Map or config object cannot renew native binding authority.
    const bindings = new Map(
      [...composition.configuration.bindings].map(
        ([subject, binding]) =>
          [subject, Object.freeze({ ...binding })] as const,
      ),
    );
    this.composition = Object.freeze({
      ...composition,
      configuration: Object.freeze({ ...composition.configuration, bindings }),
    });
  }

  createHandle(
    source: PrivatePeopleSource,
    bytes: Uint8Array,
    end: PrivatePeopleDeadline,
  ) {
    if (this.composition.enabled !== true)
      throw new Error('Private people unavailable');
    const captured = capturePrivatePeople(source, bytes);
    // Snapshot/validation only. No connection, QueryRunner, UUID or native IO.
    return new PrivatePeopleTransaction(this.composition, captured, end);
  }
}

class PrivatePeopleTransaction {
  private runner?: WorkspaceQueryRunner;
  private events?: PrivateInsertEvents;
  private pending?: Promise<unknown>;
  private abandoned = false;
  private prepared = false;
  private committing = false;
  private committed = false;
  private disposed = false;
  private ids: string[] = [];

  constructor(
    private readonly composition: Composition,
    private readonly captured: ReturnType<typeof capturePrivatePeople>,
    private readonly end: PrivatePeopleDeadline,
  ) {}

  private current() {
    this.end.remaining();
    if (
      this.abandoned ||
      Date.now() >= Date.parse(this.captured.source.expires_at)
    )
      throw new Error('Private people deadline unavailable');
  }

  private async owned<T>(
    operation: () => Promise<T>,
    deadline = this.end,
  ): Promise<T> {
    if (this.pending) throw new Error('Private people operation unsettled');
    const remaining = deadline.remaining();
    const task = operation();
    this.pending = task;
    // Keep custody after timeout. Never start rollback concurrently with a
    // still-pending connect/query/COMMIT or lose a late QueryRunner acquisition.
    task.then(
      () => {
        this.pending = undefined;
      },
      () => {
        this.pending = undefined;
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Private people deadline unavailable'));
      deadline.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(onAbort, remaining);
      if (deadline.signal.aborted) onAbort();
    });
    try {
      const result = await Promise.race([task, abort]);
      deadline.remaining();
      return result;
    } finally {
      clearTimeout(timer);
      deadline.signal.removeEventListener('abort', onAbort);
    }
  }

  async prepare() {
    this.current();
    if (this.prepared || this.runner)
      throw new Error('Private people handle already used');
    const { orm, configuration, core, cache } = this.composition;
    const source = this.captured.source;
    // Acquire on the already-retained handle. A late data-source return cannot
    // allocate a runner after an expired/abandoned request.
    const dataSource = await this.owned(() =>
      orm.getGlobalWorkspaceDataSource(),
    );
    this.current();
    if (
      dataSource.coreDataSource !== core ||
      endpoint(dataSource) !== endpoint(core)
    )
      throw new Error('Private people metadata database binding unavailable');
    if (dataSource.subscribers.length !== 0)
      throw new Error('Private people subscriber boundary unavailable');
    const timeout = dataSource.options.extra?.connectionTimeoutMillis;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 250)
      throw new Error('Private people connection deadline unavailable');
    this.runner = dataSource.createQueryRunner('master');
    const runner = this.runner;
    try {
      await this.owned(() => runner.connect());
      this.current();
      await this.owned(() => runner.startTransaction());
      this.current();
      await this.owned(() =>
        runner.query(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
          [String(this.end.remaining())],
        ),
      );
      await this.owned(() =>
        assertPrivatePeopleDatabaseRole(runner, configuration.nativeSchema),
      );
      this.current();
      const binding = configuration.bindings.get(source.subject_id);
      if (!binding) throw new Error('Private people binding unavailable');
      await this.owned(() =>
        runner.query(
          'SELECT core.lock_private_people_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            source.native_id,
            source.subject_id,
            source.company_id,
            source.binding_id,
            source.generation_id,
            source.client_id,
            source.audience,
            source.request_id,
            binding.user_id,
            binding.user_workspace_id,
            binding.workspace_member_id,
          ],
        ),
      );
      this.current();
      const identity = await this.owned(() =>
        readPrivatePeopleIdentity(
          runner,
          core,
          configuration,
          source,
          this.end,
        ),
      );
      this.current();
      await this.owned(() =>
        cache.invalidateAndRecompute(source.native_id, [
          'userWorkspaceRoleMap',
          'rolesPermissions',
          'flatObjectMetadataMaps',
          'flatFieldMetadataMaps',
          'flatRowLevelPermissionPredicateMaps',
          'flatRowLevelPermissionPredicateGroupMaps',
          'ORMEntityMetadatas',
        ]),
      );
      this.current();
      this.ids = this.captured.rows.map(() => randomUUID());
      await this.owned(() =>
        orm.executeInWorkspaceContext(async () => {
          this.current();
          if (
            getWorkspaceContext().userWorkspaceRoleMap[
              binding.user_workspace_id
            ] !== identity.roleId
          )
            throw new Error('Private people cached role unavailable');
          if (
            dataSource.authContext.type !== 'user' ||
            dataSource.authContext.userWorkspaceId !== binding.user_workspace_id
          )
            throw new Error('Private people context unavailable');
          await assertPrivatePeopleDatabaseRole(
            runner,
            configuration.nativeSchema,
          );
          this.current();
          const metadata = dataSource.getMetadata('person');
          if (
            metadata.beforeInsertListeners.length ||
            metadata.afterInsertListeners.length
          )
            throw new Error(
              'Private people entity listener boundary unavailable',
            );
          this.events = new PrivateInsertEvents(
            runner,
            source.native_id,
            this.end,
          );
          const repository =
            runner.manager.getRepository<PersonWorkspaceEntity>(
              'person',
              { unionOf: [identity.roleId] },
              identity.authContext,
            );
          const result = await repository
            .createQueryBuilder()
            .insert()
            .usePrivateTransaction(this.events)
            .values(
              this.captured.rows.map((row, index) => ({
                id: this.ids[index],
                name: { firstName: row.name, lastName: '' },
                emails: { primaryEmail: row.email, additionalEmails: [] },
                createdBy: {
                  source:
                    source.action === 'crm:people:import'
                      ? FieldActorSource.IMPORT
                      : FieldActorSource.API,
                  workspaceMemberId: identity.authContext.workspaceMemberId,
                  name: identity.authContext.user.firstName,
                  context: {},
                },
              })),
            )
            .execute();
          if (
            result.identifiers.length !== this.ids.length ||
            result.identifiers.some((row, index) => row.id !== this.ids[index])
          )
            throw new Error('Private people inserted identity unavailable');
          this.current();
        }, identity.authContext),
      );
      this.current();
      await this.owned(() =>
        runner.query(
          `INSERT INTO core."privatePeopleRequest"
        ("requestId","companyId","subjectId","workspaceId","bindingId","generationId","clientId",audience,
         "authzEpoch","policyRevision",action,"payloadSha256","nativeRecordIds","expiresAt",
         "currentRole","nativeUserId","nativeUserWorkspaceId","nativeWorkspaceMemberId","nativeRoleId")
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            source.request_id,
            source.company_id,
            source.subject_id,
            source.native_id,
            source.binding_id,
            source.generation_id,
            source.client_id,
            source.audience,
            source.authz_epoch,
            source.policy_revision,
            source.action,
            source.payload_sha256,
            this.ids,
            source.expires_at,
            source.current_role,
            binding.user_id,
            binding.user_workspace_id,
            binding.workspace_member_id,
            identity.roleId,
          ],
        ),
      );
      this.current();
      this.prepared = true;
    } catch (error) {
      this.abandoned = true;
      this.events?.abandon();
      // Core owns the handle already and will settle pending work then rollback.
      throw error;
    }
  }

  async commit() {
    this.current();
    if (
      !this.prepared ||
      !this.runner ||
      !this.events ||
      this.committing ||
      this.committed
    )
      throw new Error('Private people commit unavailable');
    const runner = this.runner;
    this.committing = true;
    try {
      await this.owned(() =>
        assertPrivatePeopleDatabaseRole(
          runner,
          this.composition.configuration.nativeSchema,
        ),
      );
      this.current();
      await this.owned(() =>
        readPrivatePeopleIdentity(
          runner,
          this.composition.core,
          this.composition.configuration,
          this.captured.source,
          this.end,
        ),
      );
      this.current();
      await this.owned(() => runner.commitTransaction());
      this.current();
      this.events.acknowledgeCommit();
      this.committed = true;
      return {
        request_id: this.captured.source.request_id,
        native_record_ids: [...this.ids],
        commit: 'acknowledged' as const,
      };
    } catch (error) {
      this.abandoned = true;
      this.events.abandon();
      // A committed-but-late or lost acknowledgement is never converted to
      // rollback success or a retry; immutable native ledger reconciliation is
      // separate and requires fresh Core authority.
      throw new PrivatePeopleUncertain(error);
    }
  }

  private async settlePending(deadline: PrivatePeopleDeadline) {
    if (!this.pending) return;
    const pending = this.pending;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Private people disposal unproved')),
            deadline.remaining(),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async rollback(deadline: PrivatePeopleDeadline) {
    this.abandoned = true;
    this.events?.abandon();
    await this.settlePending(deadline);
    const runner = this.runner;
    if (runner?.isTransactionActive && !this.committed)
      await this.owned(() => runner.rollbackTransaction(), deadline);
  }

  async dispose(deadline: PrivatePeopleDeadline) {
    if (this.disposed) throw new Error('Private people disposal already used');
    this.disposed = true;
    try {
      await this.settlePending(deadline);
      const runner = this.runner;
      if (runner && !runner.isReleased) {
        if (runner.isTransactionActive)
          await this.owned(() => runner.rollbackTransaction(), deadline);
        await this.owned(() => runner.release(), deadline);
      }
    } catch (error) {
      // Do not start new rollback/release after the immutable cleanup end.
      // A still-pending acquisition/query remains uncertain and quarantined.
      // A protected one-shot parent must fail-stop its owned process/pool under
      // its already admitted end; no late callback proves socket/SQL closure.
      throw new PrivatePeopleUncertain(error);
    }
  }

  async postCommit(deadline: PrivatePeopleDeadline) {
    deadline.remaining();
    this.current();
    if (!this.committed || !this.disposed || this.abandoned || !this.events)
      throw new Error('Private people publication unavailable');
    this.events.publish(this.composition.emitter);
  }
}
