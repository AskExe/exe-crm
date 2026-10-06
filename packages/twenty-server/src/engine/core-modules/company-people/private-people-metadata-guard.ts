import { type DataSource } from 'typeorm';

// Source projection only. No SQL grants, table creation or role repair. Positive
// generated-query/column qualification remains required before any native launch.
const tables = new Set([
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
  'application',
  'permissionFlag',
  'indexMetadata',
  'indexFieldMetadata',
  'featureFlag',
  'view',
  'viewField',
  'viewFilter',
  'viewSort',
]);
export const assertPrivatePeopleMetadataRole = async (source: DataSource) => {
  const projection = source.entityMetadatas
    .filter(
      (entity) => entity.schema === 'core' && tables.has(entity.tableName),
    )
    .flatMap((entity) =>
      entity.columns.map(
        (column) => `${entity.tableName}.${column.databaseName}`,
      ),
    );
  if (new Set(projection).size !== projection.length || projection.length === 0)
    throw new Error('Private assembly metadata projection unavailable');
  const rows = await source.query(
    `SELECT
    session_user=current_user AND r.rolname='crm_people_metadata'
    AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreatedb
    AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
    AND d.datdba<>r.oid AND NOT has_database_privilege(current_database(),'CREATE,TEMP')
    AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
      AND (n.nspowner=r.oid OR has_schema_privilege(n.oid,'CREATE')))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND (
        c.relowner=r.oid OR
        CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'SELECT,USAGE,UPDATE')
        WHEN c.relkind IN ('r','p','v','m','f') THEN
          has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
          has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES') OR
          EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
            AND has_column_privilege(c.oid,a.attnum,'SELECT')
            AND NOT(n.nspname='core' AND (c.relname||'.'||a.attname)=ANY($1::text[])))
        ELSE false END))
    AND NOT EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema'
      AND (f.proowner=r.oid OR f.prosecdef AND has_function_privilege(f.oid,'EXECUTE')))
    AS allowed FROM pg_roles r JOIN pg_database d ON d.datname=current_database()
    WHERE r.rolname=current_user`,
    [projection],
  );
  if (rows.length !== 1 || rows[0].allowed !== true)
    throw new Error('Private assembly metadata privilege unavailable');
};
