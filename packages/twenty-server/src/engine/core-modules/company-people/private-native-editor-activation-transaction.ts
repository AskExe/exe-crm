import { Socket } from 'node:net';
import { types } from 'node:util';
import { Client } from 'pg';
import { type QueryRunner } from 'typeorm';
import { v5 } from 'uuid';
import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type PrivatePeopleDeadline } from './private-people-contract';
import {
  readPrivateNativeActivationAck,
  type PrivateNativeActivationAck,
} from './private-native-activation-correspondence';
import {
  PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE,
  type PrivateNativeEditorActivationCredential,
} from './private-native-editor-activation-credential';
import { type NativeEditorActivationProjection } from './private-native-editor-activation-projection';
import { PrivateNativeEditorActivationOperationOwner } from './private-native-editor-activation-operation-owner';
import { nativeEditorActivationUnavailable as unavailable } from './private-native-editor-activation-errors';
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => Error;

export class PrivateNativeEditorActivationTransaction extends PrivateNativeEditorActivationOperationOwner {
  private runner?: QueryRunner;
  protected disposing = false;
  private abandoned = false;
  private prepared = false;
  private commitAttempted = false;
  private committed = false;
  private disposed = false;
  private published = false;
  private ack?: PrivateNativeActivationAck;
  private readonly abort = () => {
    this.abandoned = true;
    this.requestCancellation();
  };
  constructor(
    private readonly credential: PrivateNativeEditorActivationCredential,
    private readonly workspaceCache: WorkspaceCacheService,
    private readonly entityCache: CoreEntityCacheService,
    private readonly source: Readonly<
      Omit<NativeEditorActivationProjection, 'activation_scopes'> & {
        activation_scopes: readonly string[];
      }
    >,
    private readonly bytes: Buffer,
    private readonly end: PrivatePeopleDeadline,
  ) {
    super();
    end.signal.addEventListener('abort', this.abort, { once: true });
    if (end.signal.aborted) this.abandoned = true;
  }
  protected current() {
    const remaining = this.end.remaining();
    if (
      this.abandoned ||
      this.disposed ||
      Date.now() >= Date.parse(this.source.expires_at) ||
      remaining <= 0 ||
      remaining > 5000
    )
      throw unavailable();
    return remaining;
  }
  prepare(): Promise<void> {
    return this.own(() => this.prepareOwned());
  }

  private async prepareOwned(): Promise<void> {
    this.current();
    if (this.runner || this.prepared) throw unavailable();
    this.control = this.credential.createCancellationClient();
    // This owned client has fixed 500ms connect/query/server bounds and no
    // authority beyond the same least-privilege native login.
    this.control.on('error', (error: unknown) => {
      this.cancellationFailed = true;
      this.cancellationError = error;
      this.abandoned = true;
    });
    await this.control.connect();
    this.current();
    const rawControl: unknown = this.control;
    if (
      typeof rawControl !== 'object' ||
      rawControl === null ||
      !('connection' in rawControl) ||
      typeof rawControl.connection !== 'object' ||
      rawControl.connection === null ||
      !('stream' in rawControl.connection) ||
      !(rawControl.connection.stream instanceof Socket)
    )
      throw unavailable();
    this.controlSocket = rawControl.connection.stream;
    this.runner = this.credential.createOwnedRunner();
    const connection: unknown = await this.runner.connect();
    this.current();
    if (
      !(connection instanceof Client) ||
      !('processID' in connection) ||
      !Number.isSafeInteger(connection.processID) ||
      typeof connection.processID !== 'number' ||
      connection.processID <= 0
    )
      throw unavailable();
    const identity = await this.control.query(
      `SELECT pid,backend_start::text AS start,datname AS database,usename AS "user"
       FROM pg_stat_activity WHERE pid=$1 AND usename=current_user
         AND datname=current_database() AND pid<>pg_backend_pid()`,
      [connection.processID],
    );
    this.current();
    if (
      identity.rows.length !== 1 ||
      identity.rows[0].pid !== connection.processID ||
      typeof identity.rows[0].start !== 'string' ||
      typeof identity.rows[0].database !== 'string' ||
      identity.rows[0].user !== PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE
    )
      throw unavailable();
    this.backend = Object.freeze({
      pid: connection.processID,
      start: identity.rows[0].start,
      database: identity.rows[0].database,
      user: identity.rows[0].user,
    });
    await this.runner.startTransaction();
    this.current();
    await this.runner.query(
      "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
      [
        `${Math.floor(this.current())}ms`,
        `${Math.min(1000, Math.floor(this.current()))}ms`,
      ],
    );
    await this.credential.assertCatalog(this.end, this.runner);
    this.current();
    const s = this.source;
    const request = {
      action_id: this.credential.association.actionId,
      attempt: '1',
      audience: s.audience,
      authz_epoch: s.authz_epoch,
      binding_id: s.binding_id,
      client_id: s.client_id,
      company_id: s.company_id,
      coordinator_id: s.coordinator_id,
      database_association_sha256:
        this.credential.association.databaseAssociationSha256,
      expires_at: s.expires_at,
      generation_id: s.generation_id,
      identity_sha256: s.identity_sha256,
      native_id: s.native_id,
      parent_exp: s.parent_exp,
      parent_session_id: s.parent_session_id,
      payload_sha256: s.payload_sha256,
      policy_revision: s.policy_revision,
      profile_sha256: this.credential.association.profileSha256,
      request_id: s.request_id,
      subject_id: s.subject_id,
    };
    const rows: unknown = await this.runner.query(
      'SELECT core.activate_original_crm_editor_identity($1::jsonb,$2::bytea) AS result',
      [JSON.stringify(request), this.bytes],
    );
    this.current();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0] === null ||
      typeof rows[0] !== 'object' ||
      types.isProxy(rows[0]) ||
      Object.getPrototypeOf(rows[0]) !== Object.prototype ||
      Object.getOwnPropertySymbols(rows[0]).length !== 0 ||
      Object.values(Object.getOwnPropertyDescriptors(rows[0])).some(
        (descriptor) => !('value' in descriptor),
      ) ||
      Object.keys(rows[0]).join(',') !== 'result'
    )
      throw unavailable();
    const result = rows[0].result;
    if (
      !result ||
      Object.keys(result).sort().join(',') !== 'ackUtf8,receiptInputUtf8' ||
      typeof result.ackUtf8 !== 'string' ||
      typeof result.receiptInputUtf8 !== 'string' ||
      result.ackUtf8.length > 5464 ||
      result.receiptInputUtf8.length > 10924
    )
      throw unavailable();
    const ackBytes = Buffer.from(result.ackUtf8.replace(/\n/g, ''), 'base64');
    const receipt = Buffer.from(
      result.receiptInputUtf8.replace(/\n/g, ''),
      'base64',
    );
    const ack = readPrivateNativeActivationAck(ackBytes);
    const expectedRole = v5(
      s.activation_scopes.length === 2
        ? 'private-native-stock-record-writer-role-v1'
        : 'private-native-stock-record-reader-role-v1',
      this.credential.association.actionId,
    );
    if (
      ack.request_id !== s.request_id ||
      ack.company_id !== s.company_id ||
      ack.subject_id !== s.subject_id ||
      ack.workspace_id !== s.native_id ||
      ack.identity_sha256 !== s.identity_sha256 ||
      ack.parent_session_id !== s.parent_session_id ||
      ack.parent_exp !== s.parent_exp ||
      ack.role_id !== expectedRole ||
      !receipt.equals(
        Buffer.from(JSON.stringify([s.request_id, s.payload_sha256, ack])),
      )
    )
      throw unavailable();
    await this.credential.assertCatalog(this.end, this.runner);
    this.current();
    this.ack = ack;
    this.prepared = true;
  }
  commit(): Promise<PrivateNativeActivationAck> {
    return this.own(() => this.commitOwned());
  }
  private async commitOwned(): Promise<PrivateNativeActivationAck> {
    this.current();
    if (!this.runner || !this.prepared || !this.ack || this.commitAttempted)
      throw unavailable();
    this.commitAttempted = true;
    await this.runner.commitTransaction();
    this.current();
    this.committed = true;
    return this.ack;
  }
  async rollback(end: PrivatePeopleDeadline): Promise<void> {
    if (this.disposing) throw unavailable();
    this.abandoned = true;
    await this.settled(end);
    if (this.commitAttempted) throw unavailable();
    end.remaining();
    await this.cleanupOperation(
      async () => {
        if (this.runner?.isTransactionActive)
          await this.runner.rollbackTransaction();
      },
      end,
      'sql',
    );
  }
  async dispose(end: PrivatePeopleDeadline): Promise<void> {
    if (this.disposed || this.disposing) throw unavailable();
    this.disposing = true;
    this.abandoned = true;
    let primary: unknown;
    let failed = false;
    const secondary: unknown[] = [];
    const remember = (error: unknown) => {
      if (!failed) {
        failed = true;
        primary = error;
      } else secondary.push(error);
    };
    try {
      end.remaining();
      await this.settled(end);
      if (this.operationFailed) remember(this.operationError);
      for (const error of this.operationSecondary) remember(error);
      if (this.cancellation) await this.cancellation;
      if (this.cancellationFailed) remember(this.cancellationError);
      end.remaining();
    } catch (error) {
      remember(error);
    }
    // An unsettled SQL operation is unknown, not a released/disposed handle.
    // Do not race rollback/release or erase its parameter buffer.
    if (!this.pendingSettled || !this.cancellationSettled) {
      this.disposing = false;
      throw new AggregateError(
        [primary, ...secondary],
        'Native activation SQL settlement unknown',
      );
    }
    try {
      // Fixed connection rollback is cleanup only. A failed/uncertain COMMIT
      // stays uncertain and cannot become an acknowledged activation.
      if (this.runner?.isTransactionActive) {
        await this.cleanupOperation(
          () => this.runner!.rollbackTransaction(),
          end,
          'sql',
        );
      }
    } catch (error) {
      remember(error);
    }
    if (!this.pendingSettled || !this.cancellationSettled) {
      this.disposing = false;
      throw new AggregateError(
        [primary, ...secondary],
        'Native activation rollback settlement unknown',
      );
    }
    try {
      if (this.runner && !this.runner.isReleased) {
        await this.cleanupOperation(
          () => this.runner!.release(),
          end,
          'release',
        );
      }
    } catch (error) {
      remember(error);
    }
    if (!this.pendingSettled || !this.cancellationSettled) {
      this.disposing = false;
      throw new AggregateError(
        [primary, ...secondary],
        'Native activation release settlement unknown',
      );
    }
    try {
      if (this.control) {
        await this.cleanupOperation(
          async () => {
            await this.control!.end();
            this.controlClosed = true;
          },
          end,
          'control-close',
        );
      }
    } catch (error) {
      remember(error);
    }
    this.bytes.fill(0);
    this.end.signal.removeEventListener('abort', this.abort);
    this.disposed =
      (!this.runner || this.runner.isReleased) &&
      (!this.control || this.controlClosed) &&
      this.pendingSettled &&
      this.cancellationSettled;
    this.disposing = false;
    if (!this.disposed) remember(unavailable());
    if (failed)
      throw new AggregateError(
        [primary, ...secondary],
        'Native editor activation closure unavailable',
      );
  }
  async postCommit(end: PrivatePeopleDeadline): Promise<void> {
    end.remaining();
    if (!this.committed || !this.disposed || !this.ack || this.published)
      throw unavailable();
    // Core invokes this only after its COMPLETE settlement. Failures keep
    // publication unavailable; these caches never mint authority or a session.
    await this.entityCache.invalidate('user', this.ack.user_id);
    end.remaining();
    await this.workspaceCache.invalidateAndRecompute(this.source.native_id, [
      'flatRoleTargetMaps',
      'userWorkspaceRoleMap',
      'rolesPermissions',
    ]);
    end.remaining();
    this.published = true;
  }
}
