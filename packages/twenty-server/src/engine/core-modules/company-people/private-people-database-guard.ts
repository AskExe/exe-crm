import { type QueryRunner } from 'typeorm';

import { PRIVATE_PEOPLE_LOCK_BODY } from './private-people-lock-policy';

const reads = [
  'workspace',
  'user',
  'userWorkspace',
  'role',
  'roleTarget',
  'objectPermission',
  'fieldPermission',
  'objectMetadata',
  'fieldMetadata',
  'rowLevelPermissionPredicate',
  'rowLevelPermissionPredicateGroup',
  'privatePeopleRequest',
  'privatePeopleOperatorBinding',
];

// Fresh effective catalog ceiling, independent of native object permissions.
// No role creation/grant repair; an unsupported measured composition refuses.
export const assertPrivatePeopleDatabaseRole = async (
  runner: QueryRunner,
  schema: string,
) => {
  const rows = await runner.query(
    `SELECT
    session_user=current_user AND NOT r.rolsuper AND NOT r.rolcreaterole
      AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND r.rolcanlogin AND NOT r.rolinherit AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
      AND NOT has_database_privilege(current_database(),'CREATE')
      AND NOT has_database_privilege(current_database(),'TEMP')
      AND d.datdba<>r.oid
      AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
        AND (n.nspowner=r.oid OR has_schema_privilege(n.oid,'CREATE')))
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (
          c.relowner=r.oid OR
          (CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE') OR has_sequence_privilege(c.oid,'UPDATE') ELSE false END) OR
          (CASE WHEN c.relkind IN ('r','p','v','m','f') THEN (
            has_table_privilege(c.oid,'UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR
            has_any_column_privilege(c.oid,'UPDATE,REFERENCES') OR
            ((has_table_privilege(c.oid,'INSERT') OR has_any_column_privilege(c.oid,'INSERT')) AND
              NOT (n.nspname=$1 AND c.relname='person' OR n.nspname='core' AND c.relname='privatePeopleRequest')) OR
            ((has_table_privilege(c.oid,'SELECT') OR has_any_column_privilege(c.oid,'SELECT')) AND
              NOT (n.nspname=$1 AND c.relname IN ('person','workspaceMember') OR n.nspname='core' AND c.relname=ANY($2::text[])))
          ) ELSE false END)))
      AND EXISTS(SELECT 1 FROM pg_proc f JOIN pg_roles o ON o.oid=f.proowner
        WHERE f.oid='core.lock_private_people_policy(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid)'::regprocedure
          AND f.prosecdef AND f.prosrc=$3 AND f.prokind='f' AND f.prorettype='void'::regtype
          AND (SELECT lanname FROM pg_language WHERE oid=f.prolang)='plpgsql'
          AND f.proconfig=ARRAY['search_path=pg_catalog']::text[]
          AND o.rolname='crm_private_people_policy_lock' AND NOT o.rolcanlogin
          AND NOT o.rolsuper AND NOT o.rolinherit AND NOT o.rolcreaterole
          AND NOT o.rolcreatedb AND NOT o.rolreplication AND NOT o.rolbypassrls
          AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=o.oid OR m.member=o.oid))
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (
          p.proowner=r.oid OR p.prosecdef AND has_function_privilege(p.oid,'EXECUTE') AND
          p.oid<>'core.lock_private_people_policy(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid)'::regprocedure))
      AS allowed
    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`,
    [schema, reads, PRIVATE_PEOPLE_LOCK_BODY],
  );
  if (rows.length !== 1 || rows[0].allowed !== true)
    throw new Error('Private people database privilege unavailable');
};
