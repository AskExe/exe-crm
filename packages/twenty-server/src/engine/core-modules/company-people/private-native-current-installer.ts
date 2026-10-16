import { type DataSource, type QueryRunner } from 'typeorm';

import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';

import {
  PRIVATE_NATIVE_CURRENT_BODY,
  PRIVATE_NATIVE_CURRENT_FUNCTION,
  PRIVATE_NATIVE_CURRENT_ROLE,
} from './private-native-current-policy';

// The operator supplies an already reviewed distinct reader login and SELECT
// grants. This installs no login, membership, DML privilege, route or provider.
export async function installPrivateNativeCurrentFunction(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
): Promise<void> {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  await checkpoint.assertNativeEndpoint(database);
  const runner = database.createQueryRunner();
  let commitAttempted = false;
  try {
    await runner.connect();
    await runner.startTransaction();
    await checkpoint.assertCurrent();
    const remaining = Math.floor(
      checkpoint.remainingOriginalWorkMilliseconds(),
    );
    if (remaining < 1)
      throw new Error('Private native current installation unavailable');
    await runner.query(
      "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
      [`${Math.min(5000, remaining)}ms`],
    );
    const identity: unknown = await runner.query(
      `SELECT
      current_user=session_user AND current_user='crm_setup_operator' AND r.oid=10
      AND r.rolsuper AND r.rolcanlogin AS owner,
      EXISTS(SELECT 1 FROM pg_roles reader WHERE reader.rolname=$1 AND reader.rolcanlogin
        AND NOT reader.rolsuper AND NOT reader.rolinherit AND NOT reader.rolcreatedb
        AND NOT reader.rolcreaterole AND NOT reader.rolreplication AND NOT reader.rolbypassrls
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=reader.oid OR roleid=reader.oid)) AS reader
      FROM pg_roles r WHERE r.rolname=current_user`,
      [PRIVATE_NATIVE_CURRENT_ROLE],
    );
    if (
      !Array.isArray(identity) ||
      identity.length !== 1 ||
      identity[0]?.owner !== true ||
      identity[0]?.reader !== true
    )
      throw new Error('Private native current installation unavailable');
    const existing: unknown = await runner.query(
      "SELECT oid FROM pg_proc WHERE pronamespace='core'::regnamespace AND proname='lock_original_crm_current_identity'",
    );
    if (!Array.isArray(existing))
      throw new Error('Private native current installation unavailable');
    if (existing.length === 0) {
      await runner.query(`CREATE FUNCTION core.lock_original_crm_current_identity(expected jsonb)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
        SET search_path=pg_catalog,core,pg_temp AS $current_body$${PRIVATE_NATIVE_CURRENT_BODY}$current_body$`);
      await runner.query(
        `REVOKE ALL ON FUNCTION ${PRIVATE_NATIVE_CURRENT_FUNCTION} FROM PUBLIC`,
      );
      await runner.query(
        `GRANT EXECUTE ON FUNCTION ${PRIVATE_NATIVE_CURRENT_FUNCTION} TO ${PRIVATE_NATIVE_CURRENT_ROLE}`,
      );
    }
    const observed: unknown = await runner.query(
      `SELECT p.prosrc AS body,
      p.prosecdef AND p.proowner=10 AND p.prorettype='boolean'::regtype
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND NOT p.proretset AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
      AND NOT p.proleakproof AND NOT p.proisstrict AND p.pronargs=1 AND p.proargtypes='3802'::oidvector
      AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.proargnames=ARRAY['expected']::text[]
      AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.prosqlbody IS NULL
      AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
      AND has_function_privilege($1,p.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee NOT IN(10,(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
          acl.privilege_type<>'EXECUTE' OR acl.is_grantable OR acl.grantor<>10) AS helper
      FROM pg_proc p WHERE p.pronamespace='core'::regnamespace AND p.proname='lock_original_crm_current_identity'
        AND p.oid=to_regprocedure($2)`,
      [PRIVATE_NATIVE_CURRENT_ROLE, PRIVATE_NATIVE_CURRENT_FUNCTION],
    );
    if (
      !Array.isArray(observed) ||
      observed.length !== 1 ||
      existing.length > 1 ||
      observed[0]?.body !== PRIVATE_NATIVE_CURRENT_BODY ||
      observed[0]?.helper !== true
    )
      throw new Error('Private native current installation unavailable');
    await checkpoint.assertCurrent();
    commitAttempted = true;
    await runner.commitTransaction();
    await checkpoint.assertCurrent();
    await runner.release();
  } catch (primary) {
    const cleanup: unknown[] = [];
    if (!commitAttempted && runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction();
      } catch (error) {
        cleanup.push(error);
      }
    }
    if (!runner.isTransactionActive && !runner.isReleased) {
      try {
        await runner.release();
      } catch (error) {
        cleanup.push(error);
      }
    }
    // A lost COMMIT or rollback acknowledgment keeps the exact runner. There
    // is no automatic replay, replacement helper or successful closure claim.
    throw new PrivateNativeCurrentInstallationUncertain(
      primary,
      cleanup,
      runner,
      commitAttempted,
    );
  }
}

export class PrivateNativeCurrentInstallationUncertain extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanup: readonly unknown[],
    readonly retainedRunner: QueryRunner,
    readonly commitAttempted: boolean,
  ) {
    super('Private native current installation uncertain');
    for (const field of [
      'primary',
      'cleanup',
      'retainedRunner',
      'commitAttempted',
    ])
      Object.defineProperty(this, field, { enumerable: false });
  }
}
