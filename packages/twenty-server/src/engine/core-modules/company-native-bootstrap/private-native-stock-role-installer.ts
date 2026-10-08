import { createHash } from 'node:crypto';

import { type DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import {
  PRIVATE_NATIVE_STOCK_BEGIN_BODY,
  PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER,
  PRIVATE_NATIVE_STOCK_DISABLE_BODY,
  PRIVATE_NATIVE_STOCK_PARENT_ROLE,
  PRIVATE_NATIVE_STOCK_WITHDRAW_BODY,
  PRIVATE_NATIVE_STOCK_OBSERVE_BODY,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-policy';
import { PrivateNativeStockSetupUncertain } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-identity';

export const PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: 'begin_original_stock_setup',
    body: PRIVATE_NATIVE_STOCK_BEGIN_BODY,
  }),
  Object.freeze({
    name: 'disable_original_stock_setup',
    body: PRIVATE_NATIVE_STOCK_DISABLE_BODY,
  }),
  Object.freeze({
    name: 'withdraw_original_stock_setup',
    body: PRIVATE_NATIVE_STOCK_WITHDRAW_BODY,
  }),
  Object.freeze({
    name: 'observe_original_stock_workspace',
    body: PRIVATE_NATIVE_STOCK_OBSERVE_BODY,
  }),
]);

// Source-only installation entry, not imported by a module, CLI or runtime.
// The parent credential is a separate profile prerequisite, never created here.
export async function installPrivateStockParentFunctions(
  checkpoint: PrivateNativeStockActionCheckpoint,
  bootstrapDatabase: DataSource,
): Promise<void> {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  await checkpoint.assertNativeEndpoint(bootstrapDatabase);
  const runner = bootstrapDatabase.createQueryRunner();
  let primary: unknown;
  let commitAttempted = false;
  const cleanupErrors: unknown[] = [];
  try {
    await runner.connect();
    await checkpoint.assertCurrent();
    const identity: unknown = await runner.query(
      `SELECT session_user=current_user
      AND current_user=$1 AND r.oid=10 AND r.rolsuper AND r.rolcanlogin
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
      AS owner_matches,
      EXISTS(SELECT 1 FROM pg_roles p WHERE p.rolname=$2 AND p.rolcanlogin
        AND NOT p.rolsuper AND NOT p.rolinherit AND NOT p.rolcreatedb
        AND NOT p.rolcreaterole AND NOT p.rolreplication AND NOT p.rolbypassrls
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=p.oid OR roleid=p.oid)
        AND NOT has_database_privilege(p.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(p.oid,current_database(),'TEMP')
        AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database()
          AND has_database_privilege(p.oid,d.oid,'CONNECT'))
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
          AND n.nspname<>'information_schema' AND has_schema_privilege(p.oid,n.oid,'CREATE'))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
          (c.relowner=p.oid OR CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
            has_any_column_privilege(p.oid,c.oid,'SELECT') OR has_any_column_privilege(p.oid,c.oid,'INSERT') OR
            has_any_column_privilege(p.oid,c.oid,'UPDATE') OR has_table_privilege(p.oid,c.oid,'DELETE') OR
            has_table_privilege(p.oid,c.oid,'TRUNCATE') OR has_table_privilege(p.oid,c.oid,'TRIGGER') OR
            has_any_column_privilege(p.oid,c.oid,'REFERENCES')
            WHEN c.relkind='S' THEN has_sequence_privilege(p.oid,c.oid,'USAGE') OR
            has_sequence_privilege(p.oid,c.oid,'SELECT') OR has_sequence_privilege(p.oid,c.oid,'UPDATE')
            ELSE false END))
        AND NOT EXISTS(SELECT 1 FROM pg_proc candidate_function JOIN pg_namespace function_namespace
          ON function_namespace.oid=candidate_function.pronamespace WHERE function_namespace.nspname !~ '^pg_'
          AND function_namespace.nspname<>'information_schema' AND (candidate_function.proowner=p.oid OR
            candidate_function.prosecdef AND has_function_privilege(p.oid,candidate_function.oid,'EXECUTE')))) AS parent_matches
      FROM pg_roles r WHERE r.rolname=current_user`,
      [PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER, PRIVATE_NATIVE_STOCK_PARENT_ROLE],
    );
    await checkpoint.assertCurrent();
    if (
      !Array.isArray(identity) ||
      identity.length !== 1 ||
      Object.keys(identity[0]).length !== 2 ||
      identity[0].owner_matches !== true ||
      identity[0].parent_matches !== true
    )
      throw new PrivateNativeActionUnavailable();
    await runner.startTransaction();
    await runner.query("SET LOCAL statement_timeout='5s'");
    await runner.query("SET LOCAL lock_timeout='1s'");
    for (const operation of PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS) {
      await checkpoint.assertCurrent();
      const absent: unknown = await runner.query(
        `SELECT NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='core' AND p.proname=$1) AS absent`,
        [operation.name],
      );
      await checkpoint.assertCurrent();
      if (
        !Array.isArray(absent) ||
        absent.length !== 1 ||
        absent[0].absent !== true
      )
        throw new PrivateNativeActionUnavailable();
      // Names and bodies are source-fixed. A collision is never replaced/adopted.
      await runner.query(`CREATE FUNCTION core.${operation.name}() RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
        SET search_path=pg_catalog,core,pg_temp AS $stock_body$${operation.body}$stock_body$`);
      await checkpoint.assertCurrent();
      await runner.query(
        `REVOKE ALL ON FUNCTION core.${operation.name}() FROM PUBLIC`,
      );
      await checkpoint.assertCurrent();
      await runner.query(
        `GRANT EXECUTE ON FUNCTION core.${operation.name}() TO ${PRIVATE_NATIVE_STOCK_PARENT_ROLE}`,
      );
      await checkpoint.assertCurrent();
      const catalog: unknown = await runner.query(
        `SELECT p.prosrc AS body,
        p.proowner=10 AND p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::regtype
        AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.proallargtypes IS NULL AND p.proargnames IS NULL AND p.proargmodes IS NULL
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proleakproof
        AND NOT p.proisstrict AND p.prosqlbody IS NULL AND l.lanname='plpgsql'
        AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
          WHERE acl.grantee NOT IN (10,(SELECT oid FROM pg_roles WHERE rolname=$2))
          OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable)
        AND has_function_privilege($2,p.oid,'EXECUTE') AS admitted
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='core' AND p.proname=$1`,
        [operation.name, PRIVATE_NATIVE_STOCK_PARENT_ROLE],
      );
      await checkpoint.assertCurrent();
      if (
        !Array.isArray(catalog) ||
        catalog.length !== 1 ||
        catalog[0].admitted !== true ||
        typeof catalog[0].body !== 'string' ||
        createHash('sha256').update(catalog[0].body).digest('hex') !==
          createHash('sha256').update(operation.body).digest('hex')
      )
        throw new PrivateNativeActionUnavailable();
    }
    await checkpoint.assertCurrent();
    commitAttempted = true;
    await runner.commitTransaction();
    await checkpoint.assertCurrent();
  } catch (error) {
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
  if (primary || cleanupErrors.length)
    throw new PrivateNativeStockSetupUncertain(
      primary ?? new PrivateNativeActionUnavailable(),
      Object.freeze(cleanupErrors),
    );
}
