import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { DataSource, type QueryRunner } from 'typeorm';

import { type CompanyAuthConfiguration } from '../company-auth/company-auth.config';

import { type NativeEditorDatabaseAssociation } from './private-native-editor-activation-credential';
import {
  type OwnedCoreNativeAccessTransaction,
  type PrivateNativeCorrespondenceRunner,
  readPrivateNativeActivationLedger,
  verifyPrivateNativeActivationIdentity,
} from './private-native-activation-correspondence';
import {
  type OwnedCoreNativeEditorAccessTransaction,
  verifyPrivateNativeEditorCurrentRole,
} from './private-native-editor-activation-correspondence';
import { type PrivatePeopleDeadline } from './private-people-contract';
import {
  PRIVATE_NATIVE_CURRENT_BODY,
  PRIVATE_NATIVE_CURRENT_FUNCTION,
  PRIVATE_NATIVE_CURRENT_ROLE,
  PRIVATE_NATIVE_CURRENT_TABLES,
} from './private-native-current-policy';

const unavailable = () =>
  new Error('Private native identity isolation unavailable');
const held = new WeakMap<
  PrivateNativeCorrespondenceRunner,
  PrivateNativeCurrentIsolation
>();

// This is checked by both identity readers. A caller-owned runner or a copied
// handle cannot substitute for the independently acquired native lock custody.
export function assertPrivateNativeCurrentIsolation(
  runner: PrivateNativeCorrespondenceRunner,
  authority: OwnedCoreNativeAccessTransaction,
  end: PrivatePeopleDeadline,
): void {
  const owner = held.get(runner);
  if (!owner) throw unavailable();
  owner.assertHeld(authority, end);
}

export class PrivateNativeCurrentIsolation {
  private active = false;
  private verified = false;
  private admissionAttempted = false;
  private closing?: Promise<void>;
  private pending?: Promise<unknown>;
  private constructor(
    private readonly runner: QueryRunner,
    private readonly authority: OwnedCoreNativeAccessTransaction,
    private readonly deadline: PrivatePeopleDeadline,
    private readonly originalCurrent: string,
  ) {}

  static async acquire(
    database: DataSource,
    association: NativeEditorDatabaseAssociation,
    authority: OwnedCoreNativeAccessTransaction,
    end: PrivatePeopleDeadline,
  ): Promise<PrivateNativeCurrentIsolation> {
    authority.assertHeld(end);
    end.remaining();
    if (
      !association ||
      types.isProxy(association) ||
      Object.getPrototypeOf(association) !== Object.prototype ||
      Reflect.ownKeys(association).sort().join(',') !==
        'actionId,companyId,databaseAssociationSha256,profileSha256,subjectId,workspaceId' ||
      Object.values(Object.getOwnPropertyDescriptors(association)).some(
        (descriptor) => !('value' in descriptor),
      )
    )
      throw unavailable();
    const captured = Object.freeze({ ...association });
    if (
      !(database instanceof DataSource) ||
      !database.isInitialized ||
      database.options.type !== 'postgres' ||
      typeof database.options.url !== 'string' ||
      database.options.host !== undefined ||
      database.options.port !== undefined ||
      database.options.database !== undefined ||
      database.options.connectTimeoutMS !== 500
    )
      throw unavailable();
    const url = new URL(database.options.url);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.username) !== PRIVATE_NATIVE_CURRENT_ROLE
    )
      throw unavailable();
    const before = await authority.assertCurrent(end);
    if (
      captured.companyId !== before.companyId ||
      captured.subjectId !== before.subjectId ||
      captured.workspaceId !== before.workspaceId ||
      captured.profileSha256 !== before.profileSha256 ||
      captured.databaseAssociationSha256 !== before.databaseAssociationSha256 ||
      !/^[0-9a-f-]{36}$/.test(captured.actionId)
    )
      throw unavailable();
    const runner = database.createQueryRunner();
    const owner = new PrivateNativeCurrentIsolation(
      runner,
      authority,
      end,
      JSON.stringify(before),
    );
    // Retain the exact acquisition promise until it settles, including a late
    // connect/lock response. No timeout race releases a still-running operation.
    try {
      await runner.connect();
      authority.assertHeld(end);
      end.remaining();
      await runner.startTransaction('READ COMMITTED');
      const remaining = Math.floor(end.remaining());
      if (remaining < 1 || remaining > 5000) throw unavailable();
      await runner.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$1,true)",
        [`${remaining}ms`],
      );
      await assertCatalog(runner, before.workspaceId);
      authority.assertHeld(end);
      end.remaining();
      const rows: unknown = await runner.query(
        'SELECT core.lock_original_crm_current_identity($1::jsonb) AS locked',
        [JSON.stringify({ ...captured, requestId: before.requestId })],
      );
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.locked !== true)
        throw unavailable();
      authority.assertHeld(end);
      end.remaining();
      const after = await authority.assertCurrent(end);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw unavailable();
      owner.active = true;
      held.set(runner, owner);
      owner.assertHeld(authority, end);
      return owner;
    } catch (error) {
      try {
        await owner.close();
      } catch (cleanup) {
        throw new PrivateNativeCurrentIsolationFailure(error, cleanup, owner);
      }
      throw error;
    }
  }

  assertHeld(
    authority: OwnedCoreNativeAccessTransaction,
    end: PrivatePeopleDeadline,
  ): void {
    authority.assertHeld(end);
    end.remaining();
    if (
      authority !== this.authority ||
      end !== this.deadline ||
      end.signal.aborted ||
      !this.active ||
      this.closing ||
      this.runner.isReleased ||
      !this.runner.isTransactionActive ||
      held.get(this.runner) !== this
    )
      throw unavailable();
  }

  verifyIdentity(configuration: CompanyAuthConfiguration): Promise<void> {
    return this.own(async () => {
      const verified = await readPrivateNativeActivationLedger(
        this.runner,
        this.authority,
        this.deadline,
      );
      this.verified = false;
      await verifyPrivateNativeActivationIdentity(
        this.runner,
        this.authority,
        configuration,
        verified.ack,
        this.deadline,
      );
      // V1 identity correspondence alone does not satisfy the editor's exact
      // record-permission projection or the separate people-object gate.
    });
  }

  verifyEditor(authority: OwnedCoreNativeEditorAccessTransaction) {
    if (authority !== this.authority) throw unavailable();
    return this.own(async () => {
      this.verified = false;
      const result = await verifyPrivateNativeEditorCurrentRole(
        this.runner,
        authority,
        this.deadline,
      );
      this.verified = true;
      return result;
    });
  }

  // Only the protected composition supplies the actual provider admission.
  // The raw runner never escapes; COMMIT/ROLLBACK cannot release these locks.
  admit<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.verified || this.admissionAttempted)
      return Promise.reject(unavailable());
    this.admissionAttempted = true;
    return this.own(async () => {
      const before = await this.authority.assertCurrent(this.deadline);
      if (JSON.stringify(before) !== this.originalCurrent) throw unavailable();
      const result = await operation();
      const after = await this.authority.assertCurrent(this.deadline);
      if (JSON.stringify(after) !== this.originalCurrent) throw unavailable();
      return result;
    });
  }

  private async own<T>(operation: () => Promise<T>): Promise<T> {
    this.assertHeld(this.authority, this.deadline);
    if (this.pending) throw unavailable();
    const pending = Promise.resolve().then(operation);
    this.pending = pending;
    try {
      const result = await pending;
      this.assertHeld(this.authority, this.deadline);
      return result;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.active = false;
      held.delete(this.runner);
      const pending = this.pending;
      this.closing = (async () => {
        if (pending) await Promise.allSettled([pending]);
        // A rejected rollback retains this exact handle and connection. It
        // cannot be returned to the pool or reported closed.
        if (this.runner.isTransactionActive)
          await this.runner.rollbackTransaction();
        if (!this.runner.isReleased) await this.runner.release();
        if (this.runner.isTransactionActive || !this.runner.isReleased)
          throw unavailable();
      })();
    }
    return this.closing;
  }
}

// Cleanup failure carries the exact unreleased owner, never a replacement
// transaction or a successful closure acknowledgment.
export class PrivateNativeCurrentIsolationFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanup: unknown,
    readonly retained: PrivateNativeCurrentIsolation,
  ) {
    super('Private native current closure unknown');
    for (const field of ['primary', 'cleanup', 'retained'])
      Object.defineProperty(this, field, { enumerable: false });
  }
}

async function assertCatalog(
  runner: QueryRunner,
  workspaceId: string,
): Promise<void> {
  const rows: unknown = await runner.query(
    `
    SELECT current_user=session_user AND current_user=$1 AS identity,
      p.prosrc AS body,
      p.prosecdef AND p.proowner=10 AND owner.rolname='crm_setup_operator' AND owner.rolsuper AND owner.rolcanlogin
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.prorettype='boolean'::regtype AND NOT p.proretset AND p.prokind='f'
      AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proleakproof AND NOT p.proisstrict
      AND p.pronargs=1 AND p.proargtypes='3802'::oidvector AND p.proallargtypes IS NULL
      AND p.proargmodes IS NULL AND p.proargnames=ARRAY['expected']::text[]
      AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prosqlbody IS NULL
      AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
      AND has_function_privilege(current_user,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee NOT IN(10,(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR
          acl.privilege_type<>'EXECUTE' OR acl.is_grantable OR acl.grantor<>10) AS helper,
      EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
        AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole
        AND NOT r.rolreplication AND NOT r.rolbypassrls
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
        AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database() AND has_database_privilege(r.oid,d.oid,'CONNECT'))
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE')))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (c.relowner=r.oid OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN
            has_any_column_privilege(r.oid,c.oid,'INSERT') OR has_any_column_privilege(r.oid,c.oid,'UPDATE') OR
            has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'REFERENCES') OR
            (has_any_column_privilege(r.oid,c.oid,'SELECT') AND NOT
              (n.nspname='core' AND c.relname=ANY($3::text[]) OR
               n.nspname=(SELECT "databaseSchema" FROM core.workspace WHERE id=$4) AND c.relname='workspaceMember'))
          WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE') ELSE false END))
        AND NOT EXISTS(SELECT 1 FROM pg_proc other JOIN pg_namespace n ON n.oid=other.pronamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (other.proowner=r.oid OR other.prosecdef AND other.oid<>p.oid AND has_function_privilege(r.oid,other.oid,'EXECUTE')))) AS ceiling
    FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=to_regprocedure($2)`,
    [
      PRIVATE_NATIVE_CURRENT_ROLE,
      PRIVATE_NATIVE_CURRENT_FUNCTION,
      PRIVATE_NATIVE_CURRENT_TABLES,
      workspaceId,
    ],
  );
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.identity !== true ||
    rows[0]?.helper !== true ||
    rows[0]?.ceiling !== true ||
    typeof rows[0]?.body !== 'string' ||
    createHash('sha256').update(rows[0].body).digest('hex') !==
      createHash('sha256').update(PRIVATE_NATIVE_CURRENT_BODY).digest('hex')
  )
    throw unavailable();
}
