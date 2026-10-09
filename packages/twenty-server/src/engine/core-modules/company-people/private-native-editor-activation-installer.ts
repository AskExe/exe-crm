import { createHash } from 'node:crypto';

import { type DataSource } from 'typeorm';

import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeStockSetupUncertain } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-identity';

import {
  PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION,
  PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE,
} from './private-native-editor-activation-credential';
import { nativeEditorActivationUnavailable as unavailable } from './private-native-editor-activation-errors';
import { PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY } from './private-native-editor-activation-policy';

// Source-only protected setup step: no module, route, CLI or credential producer.
// The stock checkpoint and separate preexisting login remain prerequisites.
export async function installPrivateNativeEditorActivationFunction(
  checkpoint: PrivateNativeStockActionCheckpoint,
  bootstrapDatabase: DataSource,
): Promise<void> {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  await checkpoint.assertNativeEndpoint(bootstrapDatabase);
  const runner = bootstrapDatabase.createQueryRunner();
  let primary: unknown;
  let failed = false;
  let commitAttempted = false;
  const cleanupErrors: unknown[] = [];
  const parameters = [
    PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE,
    PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION,
  ];
  const current = () => checkpoint.assertCurrent();
  const assertAuthority = async () => {
    await current();
    const rows: unknown = await runner.query(
      `SELECT
      session_user=current_user AND current_user='crm_setup_operator'
        AND owner.oid=10 AND owner.rolsuper AND owner.rolcanlogin
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=owner.oid OR roleid=owner.oid)
        AS identity,
      EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=$1 AND r.rolcanlogin
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
          (other.proowner=r.oid OR other.prosecdef AND other.oid IS DISTINCT FROM to_regprocedure($2)
            AND has_function_privilege(r.oid,other.oid,'EXECUTE')))) AS ceiling
      FROM pg_roles owner WHERE owner.rolname=current_user`,
      parameters,
    );
    await current();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      Object.keys(rows[0]).sort().join(',') !== 'ceiling,identity' ||
      rows[0].identity !== true ||
      rows[0].ceiling !== true
    )
      throw unavailable();
  };
  const readCatalog = async () => {
    await current();
    const rows: unknown = await runner.query(
      `SELECT p.prosrc AS body,
      p.oid=to_regprocedure($2) AND p.prosecdef AND p.proowner=10 AND owner.rolname='crm_setup_operator'
        AND owner.rolsuper AND owner.rolcanlogin AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
        AND p.prorettype='jsonb'::regtype AND NOT p.proretset AND p.prokind='f'
        AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proleakproof AND NOT p.proisstrict
        AND p.pronargs=2 AND p.proargtypes='3802 17'::oidvector
        AND p.proallargtypes IS NULL AND p.proargmodes IS NULL
        AND p.proargnames=ARRAY['request','canonical_payload']::text[]
        AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prosqlbody IS NULL
        AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
        AND has_function_privilege($1,p.oid,'EXECUTE')
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
          WHERE acl.grantee NOT IN(10,(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            acl.privilege_type<>'EXECUTE' OR acl.is_grantable OR acl.grantor<>10) AS helper
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='core' AND p.proname='activate_original_crm_editor_identity'`,
      parameters,
    );
    await current();
    if (!Array.isArray(rows)) throw unavailable();
    return rows;
  };
  const assertCatalog = (rows: unknown[]) => {
    if (
      rows.length !== 1 ||
      !rows[0] ||
      typeof rows[0] !== 'object' ||
      Object.keys(rows[0]).sort().join(',') !== 'body,helper' ||
      !('helper' in rows[0]) ||
      rows[0].helper !== true ||
      !('body' in rows[0]) ||
      typeof rows[0].body !== 'string' ||
      createHash('sha256').update(rows[0].body).digest('hex') !==
        createHash('sha256')
          .update(PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY)
          .digest('hex')
    )
      throw unavailable();
  };
  try {
    await runner.connect();
    await current();
    await runner.startTransaction();
    const remaining = Math.floor(
      checkpoint.remainingOriginalWorkMilliseconds(),
    );
    if (remaining <= 0) throw unavailable();
    await runner.query(
      "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",
      [`${Math.min(5000, remaining)}ms`, `${Math.min(1000, remaining)}ms`],
    );
    await assertAuthority();
    const existing = await readCatalog();
    if (existing.length) {
      // Exact replay observes the original helper; drift is never repaired.
      assertCatalog(existing);
    } else {
      await current();
      await runner.query(`CREATE FUNCTION core.activate_original_crm_editor_identity(request jsonb, canonical_payload bytea)
        RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
        SET search_path=pg_catalog,core,pg_temp AS $activation_body$${PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY}$activation_body$`);
      await current();
      await runner.query(
        `REVOKE ALL ON FUNCTION ${PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION} FROM PUBLIC`,
      );
      await current();
      await runner.query(
        `GRANT EXECUTE ON FUNCTION ${PRIVATE_NATIVE_EDITOR_ACTIVATION_FUNCTION} TO ${PRIVATE_NATIVE_EDITOR_ACTIVATOR_ROLE}`,
      );
      await current();
      assertCatalog(await readCatalog());
    }
    await assertAuthority();
    await current();
    commitAttempted = true;
    await runner.commitTransaction();
    await current();
  } catch (error) {
    failed = true;
    primary = error;
    if (!commitAttempted && runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  } finally {
    try {
      await runner.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (failed || cleanupErrors.length)
    throw new PrivateNativeStockSetupUncertain(
      primary ?? unavailable(),
      Object.freeze(cleanupErrors),
    );
}
