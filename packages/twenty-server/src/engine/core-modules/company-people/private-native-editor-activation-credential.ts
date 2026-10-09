import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { Client } from 'pg';

import { DataSource, type QueryRunner } from 'typeorm';

import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { type PrivatePeopleDeadline } from './private-people-contract';
import { PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY } from './private-native-editor-activation-policy';
import {
  PROJECTION_KEYS,
  type NativeEditorActivationProjection,
} from './private-native-editor-activation-projection';
export { type NativeEditorActivationProjection } from './private-native-editor-activation-projection';
import { PrivateNativeEditorActivationTransaction } from './private-native-editor-activation-transaction';
import { nativeEditorActivationUnavailable as unavailable } from './private-native-editor-activation-errors';

export const PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE =
  'exe_crm_native_identity_activator';
export const PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION =
  'core.activate_original_crm_editor_identity(jsonb,bytea)';

export type NativeEditorDatabaseAssociation = Readonly<{
  actionId: string;
  companyId: string;
  subjectId: string;
  workspaceId: string;
  profileSha256: string;
  databaseAssociationSha256: string;
}>;
const issued = new WeakSet<PrivateNativeEditorActivationCredential>();
const ownedRunners = new WeakMap<
  QueryRunner,
  PrivateNativeEditorActivationCredential
>();
// No credential creation, installer, Nest provider or public producer exists.
// The protected operator supplies its separately reviewed association and DS.
// Issuance observes the closed EXEC ACL. The fixed helper independently locks
// and matches the original native marker before any identity/role mutation.
export class PrivateNativeEditorActivationCredential {
  private constructor(
    private readonly database: DataSource,
    readonly association: NativeEditorDatabaseAssociation,
    private readonly optionsUrl: string,
  ) {}

  static async bind(
    database: DataSource,
    association: NativeEditorDatabaseAssociation,
    end: PrivatePeopleDeadline,
  ): Promise<PrivateNativeEditorActivationCredential> {
    if (
      !(database instanceof DataSource) ||
      !database.isInitialized ||
      database.options.type !== 'postgres' ||
      typeof database.options.url !== 'string' ||
      database.options.host !== undefined ||
      database.options.port !== undefined ||
      database.options.database !== undefined ||
      database.options.connectTimeoutMS !== 500 ||
      Object.keys(association).sort().join(',') !==
        'actionId,companyId,databaseAssociationSha256,profileSha256,subjectId,workspaceId' ||
      !['actionId', 'companyId', 'subjectId', 'workspaceId'].every((key) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          association[key as keyof NativeEditorDatabaseAssociation],
        ),
      ) ||
      !/^[a-f0-9]{64}$/.test(association.profileSha256) ||
      !/^[a-f0-9]{64}$/.test(association.databaseAssociationSha256)
    )
      throw unavailable();
    const url = new URL(database.options.url);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.search ||
      url.hash ||
      decodeURIComponent(url.username) !== PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE
    )
      throw unavailable();
    const value = new PrivateNativeEditorActivationCredential(
      database,
      Object.freeze({ ...association }),
      database.options.url,
    );
    await value.assertCatalog(end);
    issued.add(value);
    Object.freeze(value);
    return value;
  }

  async assertCatalog(
    end: PrivatePeopleDeadline,
    ownedRunner?: QueryRunner,
  ): Promise<void> {
    if (ownedRunner && ownedRunners.get(ownedRunner) !== this)
      throw unavailable();
    end.remaining();
    if (
      !this.database.isInitialized ||
      this.database.options.type !== 'postgres' ||
      this.database.options.url !== this.optionsUrl ||
      this.database.options.host !== undefined ||
      this.database.options.port !== undefined ||
      this.database.options.database !== undefined ||
      this.database.options.connectTimeoutMS !== 500
    )
      throw unavailable();
    const catalog = ownedRunner ?? this.database;
    const rows: unknown = await catalog.query(
      `
      SELECT current_user=session_user AND current_user=$1 AS identity,
      EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
        AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole
        AND NOT r.rolreplication AND NOT r.rolbypassrls
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
        AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database()
          AND has_database_privilege(r.oid,d.oid,'CONNECT'))
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE')))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (c.relowner=r.oid OR CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
            has_any_column_privilege(r.oid,c.oid,'SELECT') OR has_any_column_privilege(r.oid,c.oid,'INSERT') OR
            has_any_column_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR
            has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'TRIGGER') OR
            has_any_column_privilege(r.oid,c.oid,'REFERENCES') WHEN c.relkind='S' THEN
            has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT') OR
            has_sequence_privilege(r.oid,c.oid,'UPDATE') ELSE false END))
        AND NOT EXISTS(SELECT 1 FROM pg_proc other JOIN pg_namespace n ON n.oid=other.pronamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (other.proowner=r.oid OR other.prosecdef AND other.oid<>to_regprocedure($2)
            AND has_function_privilege(r.oid,other.oid,'EXECUTE')))) AS ceiling,
      p.prosrc AS body,
      p.prosecdef AND p.proowner=10 AND owner.rolname='crm_setup_operator'
        AND owner.rolsuper AND owner.rolcanlogin AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
        AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND p.prokind='f'
        AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proleakproof AND NOT p.proisstrict
        AND p.pronargs=2 AND p.proargtypes='3802 17'::oidvector
        AND p.proallargtypes IS NULL AND p.proargmodes IS NULL
        AND p.proargnames=ARRAY['request','canonical_payload']::text[]
        AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prosqlbody IS NULL
        AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
        AND has_function_privilege(current_user,p.oid,'EXECUTE')
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
          WHERE acl.grantee NOT IN(10,(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR
            acl.privilege_type<>'EXECUTE' OR acl.is_grantable OR acl.grantor<>10) AS helper
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=to_regprocedure($2)`,
      [
        PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE,
        PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION,
      ],
    );
    end.remaining();
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
      Object.keys(rows[0]).sort().join(',') !==
        'body,ceiling,helper,identity' ||
      rows[0].identity !== true ||
      rows[0].ceiling !== true ||
      rows[0].helper !== true ||
      typeof rows[0].body !== 'string' ||
      createHash('sha256').update(rows[0].body).digest('hex') !==
        createHash('sha256')
          .update(PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY)
          .digest('hex')
    )
      throw unavailable();
  }

  createCancellationClient(): Client {
    if (!issued.has(this)) throw unavailable();
    return new Client({
      connectionString: this.optionsUrl,
      connectionTimeoutMillis: 500,
      statement_timeout: 500,
      query_timeout: 500,
    });
  }

  createOwnedRunner(): QueryRunner {
    if (!issued.has(this)) throw unavailable();
    const runner = this.database.createQueryRunner();
    ownedRunners.set(runner, this);
    return runner;
  }
}

// Only the protected operator can supply this separate credential and actual
// native caches. Nothing registers this adapter in a module, route or worker.
export async function bindPrivateNativeEditorActivationAdapter(
  enabled: boolean,
  database: DataSource,
  association: NativeEditorDatabaseAssociation,
  workspaceCache: WorkspaceCacheService,
  entityCache: CoreEntityCacheService,
  end: PrivatePeopleDeadline,
) {
  if (enabled !== true) throw unavailable();
  const credential = await PrivateNativeEditorActivationCredential.bind(
    database,
    association,
    end,
  );
  return Object.freeze(
    new PrivateNativeEditorActivationAdapter(
      credential,
      workspaceCache,
      entityCache,
    ),
  );
}

class PrivateNativeEditorActivationAdapter {
  constructor(
    private readonly credential: PrivateNativeEditorActivationCredential,
    private readonly workspaceCache: WorkspaceCacheService,
    private readonly entityCache: CoreEntityCacheService,
  ) {}

  createHandle(
    source: NativeEditorActivationProjection,
    canonicalPayload: Uint8Array,
    end: PrivatePeopleDeadline,
  ) {
    // Snapshot only: no connection, SQL, metadata creation or new action clock.
    if (
      types.isProxy(source) ||
      Object.getPrototypeOf(source) !== Object.prototype ||
      Object.getOwnPropertySymbols(source).length !== 0 ||
      Object.keys(source).sort().join(',') !==
        [...PROJECTION_KEYS].sort().join(',') ||
      PROJECTION_KEYS.some(
        (key) => !('value' in Object.getOwnPropertyDescriptor(source, key)!),
      ) ||
      ![
        'subject_id',
        'company_id',
        'binding_id',
        'native_id',
        'generation_id',
        'request_id',
        'parent_session_id',
      ].every(
        (key) =>
          typeof source[key as keyof NativeEditorActivationProjection] ===
            'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            String(source[key as keyof NativeEditorActivationProjection]),
          ),
      ) ||
      !['identity_sha256', 'payload_sha256'].every(
        (key) =>
          typeof source[key as keyof NativeEditorActivationProjection] ===
            'string' &&
          /^[a-f0-9]{64}$/.test(
            String(source[key as keyof NativeEditorActivationProjection]),
          ),
      ) ||
      !['authz_epoch', 'policy_revision', 'parent_exp'].every(
        (key) =>
          typeof source[key as keyof NativeEditorActivationProjection] ===
            'string' &&
          /^[1-9][0-9]{0,18}$/.test(
            String(source[key as keyof NativeEditorActivationProjection]),
          ),
      ) ||
      !['client_id', 'audience'].every(
        (key) =>
          typeof source[key as keyof NativeEditorActivationProjection] ===
            'string' &&
          /^[a-z][a-z0-9_-]{2,63}$/.test(
            String(source[key as keyof NativeEditorActivationProjection]),
          ),
      ) ||
      source.version !== 2 ||
      source.entitlement_kind !== 'beta' ||
      source.commerce !== null ||
      source.purpose !== 'native-identity-activation' ||
      source.action !== 'crm:native-identity:activate' ||
      source.product !== 'crm' ||
      source.resource_kind !== 'crm-workspace' ||
      !['owner', 'member'].includes(source.current_role) ||
      source.attempt !== 1 ||
      !/^[a-z][a-z0-9_-]{2,63}$/.test(source.coordinator_id) ||
      source.company_id !== this.credential.association.companyId ||
      source.subject_id !== this.credential.association.subjectId ||
      source.native_id !== this.credential.association.workspaceId ||
      types.isProxy(source.activation_scopes) ||
      !Array.isArray(source.activation_scopes) ||
      Object.getOwnPropertySymbols(source.activation_scopes).length !== 0 ||
      ![1, 2].includes(source.activation_scopes.length) ||
      Object.keys(source.activation_scopes).length !==
        source.activation_scopes.length ||
      Array.from(
        { length: source.activation_scopes.length },
        (_, index) => index,
      ).some(
        (index) =>
          !(
            'value' in
            Object.getOwnPropertyDescriptor(
              source.activation_scopes,
              String(index),
            )!
          ),
      ) ||
      !['["crm:read"]', '["crm:read","crm:write"]'].includes(
        JSON.stringify(source.activation_scopes),
      ) ||
      typeof source.verified_email !== 'string' ||
      source.verified_email.length < 3 ||
      source.verified_email.length > 320 ||
      typeof source.email_confirmed_at !== 'string' ||
      !Number.isFinite(Date.parse(source.email_confirmed_at)) ||
      Date.parse(source.email_confirmed_at) > Date.now() ||
      typeof source.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(source.expires_at)) ||
      !(canonicalPayload instanceof Uint8Array) ||
      types.isProxy(canonicalPayload) ||
      canonicalPayload.byteLength < 1 ||
      canonicalPayload.byteLength > 4096 ||
      createHash('sha256').update(canonicalPayload).digest('hex') !==
        source.payload_sha256
    )
      throw unavailable();
    const expected = Buffer.from(
      JSON.stringify({
        subject_id: source.subject_id,
        verified_email: source.verified_email,
        email_confirmed_at: source.email_confirmed_at,
        identity_sha256: source.identity_sha256,
        activation_scopes: source.activation_scopes,
      }),
    );
    try {
      if (!expected.equals(Buffer.from(canonicalPayload))) throw unavailable();
    } finally {
      expected.fill(0);
    }
    const captured = Object.freeze({
      ...source,
      activation_scopes: Object.freeze([...source.activation_scopes]),
    });
    return new PrivateNativeEditorActivationTransaction(
      this.credential,
      this.workspaceCache,
      this.entityCache,
      captured,
      Buffer.from(canonicalPayload),
      end,
    );
  }
}
