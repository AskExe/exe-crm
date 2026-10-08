import { type DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';

export const PRIVATE_NATIVE_STOCK_ROLE = 'exe_crm_native_stock_provisioner';
export const PRIVATE_NATIVE_STOCK_READ_RELATIONS = Object.freeze(['webhook']);

// Fixed stock metadata/setup families, not every entity in the relation graph.
// Token, credential, SSO, billing and immutable private ledgers are excluded.
export const PRIVATE_NATIVE_STOCK_RELATIONS = Object.freeze([
  'user',
  'userWorkspace',
  'workspace',
  'application',
  'file',
  'featureFlag',
  'keyValuePair',
  'dataSource',
  'indexMetadata',
  'indexFieldMetadata',
  'objectMetadata',
  'fieldMetadata',
  'view',
  'viewField',
  'viewFieldGroup',
  'viewFilter',
  'viewFilterGroup',
  'viewSort',
  'viewGroup',
  'navigationMenuItem',
  'role',
  'roleTarget',
  'permissionFlag',
  'objectPermission',
  'fieldPermission',
  'rowLevelPermissionPredicate',
  'rowLevelPermissionPredicateGroup',
  'agent',
  'skill',
  'pageLayout',
  'pageLayoutTab',
  'pageLayoutWidget',
  'commandMenuItem',
  'logicFunction',
  'logicFunctionLayer',
  'frontComponent',
  'applicationVariable',
  'searchFieldMetadata',
]);

const issuedStockControls = new WeakSet<PrivateNativeStockRoleGuard>();

// Read-only admission specification. No credential or grant is installed here.
export class PrivateNativeStockRoleGuard {
  readonly #businessDatabases = new WeakMap<DataSource, string>();
  readonly #businessConnectionStrings = new WeakMap<DataSource, string>();

  static async bindControl(
    controlDatabase: DataSource,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<PrivateNativeStockRoleGuard> {
    await checkpoint.assertNativeDatabase(controlDatabase);
    const control = new PrivateNativeStockRoleGuard(
      controlDatabase,
      checkpoint,
    );
    issuedStockControls.add(control);
    await control.assertCurrent();
    return control;
  }

  async bindBusinessDatabase(database: DataSource): Promise<void> {
    if (!issuedStockControls.has(this) || database === this.database)
      throw new PrivateNativeActionUnavailable();
    await this.assertCurrent();
    await this.checkpoint.assertNativeEndpoint(database);
    const roles: unknown = await database.query(
      `SELECT inet_server_addr()::text AS address,inet_server_port() AS port,
        current_database() AS database,session_user::text AS session,current_user::text AS actor`,
    );
    await this.assertCurrent();
    const identity = this.businessIdentity(roles);
    if (
      database.options.type !== 'postgres' ||
      typeof database.options.url !== 'string'
    )
      throw new PrivateNativeActionUnavailable();
    const connection = new URL(database.options.url);
    if (
      !['postgres:', 'postgresql:'].includes(connection.protocol) ||
      decodeURIComponent(connection.username) !== PRIVATE_NATIVE_STOCK_ROLE ||
      !connection.password ||
      connection.search ||
      connection.hash ||
      decodeURIComponent(connection.pathname.slice(1)) !==
        (JSON.parse(identity) as [string, number, string, string, string])[2]
    )
      throw new PrivateNativeActionUnavailable();
    this.#businessDatabases.set(database, identity);
    this.#businessConnectionStrings.set(database, connection.toString());
  }

  async readBusinessConnectionString(
    database: DataSource,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<string> {
    await this.assertBusinessDatabase(database, checkpoint);
    const connection = this.#businessConnectionStrings.get(database);
    if (!connection) throw new PrivateNativeActionUnavailable();
    return connection;
  }

  private businessIdentity(rows: unknown): string {
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0]?.address !== 'string' ||
      rows[0].address.length > 64 ||
      !Number.isInteger(rows[0].port) ||
      rows[0].port < 1 ||
      rows[0].port > 65535 ||
      typeof rows[0].database !== 'string' ||
      rows[0].database.length > 63 ||
      rows[0].session !== PRIVATE_NATIVE_STOCK_ROLE ||
      rows[0].actor !== PRIVATE_NATIVE_STOCK_ROLE ||
      Object.keys(rows[0]).length !== 5
    )
      throw new PrivateNativeActionUnavailable();
    return JSON.stringify([
      rows[0].address,
      rows[0].port,
      rows[0].database,
      rows[0].session,
      rows[0].actor,
    ]);
  }

  assertBusinessProjection(database: DataSource, rows: unknown): void {
    if (
      !issuedStockControls.has(this) ||
      !this.#businessDatabases.has(database) ||
      this.#businessDatabases.get(database) !== this.businessIdentity(rows)
    )
      throw new PrivateNativeActionUnavailable();
  }

  withdrawBusinessDatabase(
    database: DataSource,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): void {
    if (
      !issuedStockControls.has(this) ||
      checkpoint !== this.checkpoint ||
      !this.#businessDatabases.has(database)
    )
      throw new PrivateNativeActionUnavailable();
    // Terminal local withdrawal only; no query, credential, clock or new authority.
    this.#businessDatabases.delete(database);
    this.#businessConnectionStrings.delete(database);
  }

  async assertBusinessDatabase(
    database: DataSource,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<void> {
    if (
      !issuedStockControls.has(this) ||
      checkpoint !== this.checkpoint ||
      !this.#businessDatabases.has(database)
    )
      throw new PrivateNativeActionUnavailable();
    // The separate, owned control connection is never globally fenced.
    // Its real endpoint/catalog reads cannot recursively create business runners.
    await this.assertCurrent();
  }
  constructor(
    private readonly database: DataSource,
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
  ) {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  }

  async assertFresh(businessDatabase?: DataSource): Promise<void> {
    const database = businessDatabase ?? this.database;
    if (issuedStockControls.has(this)) {
      if (!businessDatabase) throw new PrivateNativeActionUnavailable();
      await this.assertBusinessDatabase(database, this.checkpoint);
    }
    await this.assertCurrent();
    const original = this.checkpoint.pendingPlan.original;
    const rows: unknown = await database.query(
      `SELECT NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1) AS schema_absent,
       NOT EXISTS(SELECT 1 FROM core."dataSource" WHERE "workspaceId"=$2::uuid) AS datasource_absent,
       (SELECT count(*)=1 AND bool_and(id=$2::uuid) FROM core.workspace) AS sole_workspace,
       (SELECT count(*)=1 AND bool_and(id=$3::uuid) FROM core."user") AS sole_subject,
       (SELECT count(*)=1 AND bool_and(id=$4::uuid AND "userId"=$3::uuid AND "workspaceId"=$2::uuid)
         FROM core."userWorkspace") AS sole_membership`,
      [
        original.schemaName,
        original.workspaceId,
        original.userId,
        original.userWorkspaceId,
      ],
    );
    await this.assertCurrent();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0] !== 'object' ||
      rows[0] === null ||
      Object.keys(rows[0]).length !== 5 ||
      rows[0].schema_absent !== true ||
      rows[0].datasource_absent !== true ||
      rows[0].sole_workspace !== true ||
      rows[0].sole_subject !== true ||
      rows[0].sole_membership !== true
    ) {
      throw new PrivateNativeActionUnavailable();
    }
  }

  async assertCurrent(): Promise<void> {
    await this.checkpoint.assertNativeEndpoint(this.database);
    const original = this.checkpoint.pendingPlan.original;
    const rows: unknown = await this.database.query(
      `SELECT (session_user=$1 AND current_user=$1 OR $4::boolean) AND r.rolcanlogin
       AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls
       AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
       AND r.rolconnlimit=2 AND r.rolvaliduntil>clock_timestamp()
       AND r.rolvaliduntil<=clock_timestamp()+interval '120 seconds'
       AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
       AND has_database_privilege(r.oid,current_database(),'CONNECT')
       AND has_database_privilege(r.oid,current_database(),'CREATE')
       AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
       AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid OR
         (datname<>current_database() AND has_database_privilege(r.oid,oid,'CONNECT')))
       AND NOT has_schema_privilege(r.oid,'core','CREATE')
       AND has_schema_privilege(r.oid,'core','USAGE')
       AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$2 AND nspowner<>r.oid) AS role_matches,
       NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
         AND n.nspname<>'information_schema' AND n.nspname<>$2
         AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE') OR
           (n.nspname<>'core' AND has_schema_privilege(r.oid,n.oid,'USAGE')))) AS schema_confined,
       NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
         AND (p.proowner=r.oid AND n.nspname<>$2 OR
           p.prosecdef AND has_function_privilege(r.oid,p.oid,'EXECUTE'))) AS functions_confined,
       NOT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
         WHERE t.typowner=r.oid AND n.nspname<>$2) AS types_confined,
       NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
         AND n.nspname<>$2 AND (c.relowner=r.oid OR CASE
           WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE') OR
             has_sequence_privilege(r.oid,c.oid,'SELECT') OR has_sequence_privilege(r.oid,c.oid,'UPDATE')
           WHEN c.relkind IN ('r','p','v','m','f') THEN
             has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'TRIGGER') OR
             has_any_column_privilege(r.oid,c.oid,'REFERENCES') OR
             (NOT(n.nspname='core' AND c.relname=ANY($3::text[])) AND
               ((has_any_column_privilege(r.oid,c.oid,'SELECT') AND NOT(n.nspname='core' AND c.relname=ANY($5::text[]))) OR has_any_column_privilege(r.oid,c.oid,'INSERT') OR
                has_any_column_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE')))
           ELSE false END)) AS relations_confined,
       NOT EXISTS(SELECT 1 FROM unnest($3::text[]) AS stock(name) WHERE
         to_regclass(format('core.%I',name)) IS NULL OR NOT (
           has_table_privilege(r.oid,to_regclass(format('core.%I',name)),'SELECT') AND
           has_table_privilege(r.oid,to_regclass(format('core.%I',name)),'INSERT') AND
           has_table_privilege(r.oid,to_regclass(format('core.%I',name)),'UPDATE') AND
           has_table_privilege(r.oid,to_regclass(format('core.%I',name)),'DELETE'))) AND
       NOT EXISTS(SELECT 1 FROM unnest($5::text[]) AS stock_read(name) WHERE
         to_regclass(format('core.%I',name)) IS NULL OR NOT
           has_table_privilege(r.oid,to_regclass(format('core.%I',name)),'SELECT')) AS stock_grants_match,
       NOT EXISTS(SELECT 1 FROM (VALUES ('f'::"char"),('T'::"char")) kind(object_type)
         CROSS JOIN LATERAL aclexplode(COALESCE((SELECT d.defaclacl FROM pg_default_acl d
           WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype=kind.object_type),
           acldefault(kind.object_type,r.oid))) acl WHERE acl.grantee=0) AS public_defaults_denied
       FROM pg_roles r WHERE r.rolname=$1`,
      [
        PRIVATE_NATIVE_STOCK_ROLE,
        original.schemaName,
        PRIVATE_NATIVE_STOCK_RELATIONS,
        issuedStockControls.has(this),
        PRIVATE_NATIVE_STOCK_READ_RELATIONS,
      ],
    );
    await this.checkpoint.assertCurrent();
    const keys = [
      'role_matches',
      'schema_confined',
      'functions_confined',
      'types_confined',
      'relations_confined',
      'stock_grants_match',
      'public_defaults_denied',
    ];
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      typeof rows[0] !== 'object' ||
      rows[0] === null ||
      Object.keys(rows[0]).length !== keys.length ||
      keys.some((key) => rows[0][key] !== true)
    ) {
      throw new PrivateNativeActionUnavailable();
    }
  }
}
