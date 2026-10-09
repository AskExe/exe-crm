import { createHash } from 'node:crypto';

import { DataSource } from 'typeorm';
import { v5 } from 'uuid';

import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PRIVATE_NATIVE_STOCK_ENTITIES } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-entities';
import { PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-installer';
import { PRIVATE_NATIVE_STOCK_PARENT_ROLE } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-policy';
import { PRIVATE_NATIVE_STOCK_ROLE } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';

export type PrivateStockNativeObservation = Readonly<{
  actionId: string;
  workspaceId: string;
  schemaName: string;
  userId: string;
  userWorkspaceId: string;
  workspaceMemberId: string;
  roleId: string;
  customApplicationId: string;
  standardApplicationId: string;
  setupRemoved: true;
  recordRoles: Readonly<{
    readerRoleId: string;
    writerRoleId: string;
    personObjectMetadataId: string;
    companyObjectMetadataId: string;
  }>;
}>;
const OBSERVATION_KEYS = [
  'actionId',
  'customApplicationId',
  'recordRoles',
  'roleId',
  'schemaName',
  'setupRemoved',
  'standardApplicationId',
  'userId',
  'userWorkspaceId',
  'workspaceId',
  'workspaceMemberId',
];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const issued = new WeakSet<PrivateNativeStockParentLifecycle>();
const hash = (body: string) => createHash('sha256').update(body).digest('hex');

// This separate parent can invoke only the four source-fixed helpers. It cannot
// supply SQL, a target schema, a subject, a replacement lease or a role name.
export class PrivateNativeStockParentLifecycle {
  #begun = false;
  #disabled = false;
  #disableAttempted = false;
  #withdrawn = false;
  #withdrawAttempted = false;
  #roleOid: string | undefined;
  #business: DataSource | undefined;
  #parentIdentity: string | undefined;

  private constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
    private readonly parent: DataSource,
    private readonly original: DataSource,
  ) {}

  static async bind(
    checkpoint: PrivateNativeStockActionCheckpoint,
    parent: DataSource,
    original: DataSource,
  ): Promise<PrivateNativeStockParentLifecycle> {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    if (parent === original) throw new PrivateNativeActionUnavailable();
    await checkpoint.assertNativeDatabase(original);
    await checkpoint.assertNativeEndpoint(parent);
    const lifecycle = new PrivateNativeStockParentLifecycle(
      checkpoint,
      parent,
      original,
    );
    await lifecycle.assertCatalog();
    await checkpoint.assertCurrent();
    issued.add(lifecycle);
    return lifecycle;
  }

  assertCheckpoint(checkpoint: PrivateNativeStockActionCheckpoint): void {
    if (!issued.has(this) || this.checkpoint !== checkpoint)
      throw new PrivateNativeActionUnavailable();
  }

  private async assertCatalog(): Promise<void> {
    const identity: unknown = await this.parent.query(
      `SELECT session_user::text AS session,current_user::text AS actor,
      inet_server_addr()::text AS address,inet_server_port() AS port,current_database() AS database,
      NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls AND r.rolcanlogin
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
      AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
      AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
      AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database() AND has_database_privilege(r.oid,d.oid,'CONNECT'))
      AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
        AND (n.nspowner=r.oid OR has_schema_privilege(r.oid,n.oid,'CREATE')))
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (c.relowner=r.oid OR
        CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r.oid,c.oid,'SELECT')
          OR has_any_column_privilege(r.oid,c.oid,'INSERT') OR has_any_column_privilege(r.oid,c.oid,'UPDATE')
          OR has_any_column_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'DELETE')
          OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'TRIGGER')
        WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT')
          OR has_sequence_privilege(r.oid,c.oid,'UPDATE') ELSE false END))
      AND NOT EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
        (f.proowner=r.oid OR f.prosecdef AND has_function_privilege(r.oid,f.oid,'EXECUTE')
          AND NOT(n.nspname='core' AND f.proname=ANY($1::text[])))) AS admitted
      FROM pg_roles r WHERE r.rolname=current_user`,
      [
        PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS.map(
          (operation) => operation.name,
        ),
      ],
    );
    if (
      !Array.isArray(identity) ||
      identity.length !== 1 ||
      Object.keys(identity[0]).length !== 6 ||
      typeof identity[0].address !== 'string' ||
      identity[0].address.length > 64 ||
      !Number.isInteger(identity[0].port) ||
      typeof identity[0].database !== 'string' ||
      identity[0].database.length > 63 ||
      identity[0].session !== PRIVATE_NATIVE_STOCK_PARENT_ROLE ||
      identity[0].actor !== PRIVATE_NATIVE_STOCK_PARENT_ROLE ||
      identity[0].admitted !== true
    )
      throw new PrivateNativeActionUnavailable();
    const currentIdentity = JSON.stringify([
      identity[0].address,
      identity[0].port,
      identity[0].database,
    ]);
    if (this.#parentIdentity && this.#parentIdentity !== currentIdentity)
      throw new PrivateNativeActionUnavailable();
    this.#parentIdentity = currentIdentity;
    const catalog: unknown = await this.parent.query(
      `SELECT p.proname AS name,p.prosrc AS body,
      p.proowner=10 AND p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::regtype
      AND p.pronargs=0 AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
      AND p.proallargtypes IS NULL AND p.proargnames IS NULL AND p.proargmodes IS NULL
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proleakproof
      AND NOT p.proisstrict AND p.prosqlbody IS NULL AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=pg_catalog, core, pg_temp']::text[]
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee NOT IN(10,(SELECT oid FROM pg_roles WHERE rolname=current_user))
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
      AND has_function_privilege(current_user,p.oid,'EXECUTE') AS admitted
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='core' AND p.proname=ANY($1::text[])`,
      [
        PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS.map(
          (operation) => operation.name,
        ),
      ],
    );
    if (
      !Array.isArray(catalog) ||
      catalog.length !== PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS.length
    )
      throw new PrivateNativeActionUnavailable();
    for (const operation of PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS) {
      const matches = catalog.filter((row) => row.name === operation.name);
      if (
        matches.length !== 1 ||
        Object.keys(matches[0]).length !== 3 ||
        matches[0].admitted !== true ||
        typeof matches[0].body !== 'string' ||
        hash(matches[0].body) !== hash(operation.body)
      )
        throw new PrivateNativeActionUnavailable();
    }
  }

  async begin(): Promise<DataSource> {
    this.assertCheckpoint(this.checkpoint);
    if (this.#begun) throw new PrivateNativeActionUnavailable();
    await this.checkpoint.assertCurrent();
    await this.assertCatalog();
    await this.checkpoint.assertCurrent();
    // A lost acknowledgment is uncertain, never a reason to invoke BEGIN again.
    this.#begun = true;
    const rows: unknown = await this.parent.query(
      'SELECT core.begin_original_stock_setup() AS value',
    );
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      Object.keys(rows[0]).length !== 1
    )
      throw new PrivateNativeActionUnavailable();
    const value: unknown = rows[0].value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new PrivateNativeActionUnavailable();
    const grant = value as Record<string, unknown>;
    if (
      Object.keys(grant).sort().join(',') !==
        'actionId,database,password,role,roleOid' ||
      grant.actionId !== this.checkpoint.pendingPlan.original.actionId ||
      grant.role !== PRIVATE_NATIVE_STOCK_ROLE ||
      typeof grant.roleOid !== 'string' ||
      !/^[1-9][0-9]{0,9}$/.test(grant.roleOid) ||
      typeof grant.password !== 'string' ||
      !/^[0-9a-f]{64}$/.test(grant.password) ||
      typeof grant.database !== 'string' ||
      this.original.options.type !== 'postgres' ||
      typeof this.original.options.url !== 'string'
    )
      throw new PrivateNativeActionUnavailable();
    this.#roleOid = grant.roleOid;
    await this.checkpoint.assertCurrent();
    const connection = new URL(this.original.options.url);
    if (
      decodeURIComponent(connection.pathname.slice(1)) !== grant.database ||
      connection.search ||
      connection.hash
    )
      throw new PrivateNativeActionUnavailable();
    connection.username = PRIVATE_NATIVE_STOCK_ROLE;
    connection.password = grant.password;
    const database = new DataSource({
      type: 'postgres',
      url: connection.toString(),
      entities: [...PRIVATE_NATIVE_STOCK_ENTITIES],
      synchronize: false,
      migrationsRun: false,
      dropSchema: false,
      poolSize: 1,
      extra: {
        statement_timeout: 5000,
        lock_timeout: 1000,
        query_timeout: 5000,
      },
    });
    this.#business = database;
    await database.initialize();
    await this.checkpoint.assertCurrent();
    return database;
  }

  async disable(): Promise<void> {
    this.assertCheckpoint(this.checkpoint);
    if (!this.#begun || this.#disableAttempted || this.#withdrawn)
      throw new PrivateNativeActionUnavailable();
    // Terminal credential withdrawal does not renew or qualify expired work.
    await this.assertCatalog();
    this.#disableAttempted = true;
    const rows: unknown = await this.parent.query(
      'SELECT core.disable_original_stock_setup() AS value',
    );
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0].value?.actionId !==
        this.checkpoint.pendingPlan.original.actionId ||
      rows[0].value?.disabled !== true ||
      typeof rows[0].value?.roleOid !== 'string' ||
      !/^[1-9][0-9]{0,9}$/.test(rows[0].value.roleOid) ||
      (this.#roleOid !== undefined && rows[0].value.roleOid !== this.#roleOid)
    )
      throw new PrivateNativeActionUnavailable();
    this.#roleOid = rows[0].value.roleOid;
    this.#disabled = true;
  }

  async closeBusiness(): Promise<void> {
    this.assertCheckpoint(this.checkpoint);
    if (this.#business?.isInitialized) await this.#business.destroy();
    if (this.#business?.isInitialized)
      throw new PrivateNativeActionUnavailable();
  }

  async withdraw(): Promise<void> {
    this.assertCheckpoint(this.checkpoint);
    if (
      !this.#disabled ||
      this.#withdrawAttempted ||
      this.#business?.isInitialized
    )
      throw new PrivateNativeActionUnavailable();
    await this.assertCatalog();
    this.#withdrawAttempted = true;
    const rows: unknown = await this.parent.query(
      'SELECT core.withdraw_original_stock_setup() AS value',
    );
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0].value?.actionId !==
        this.checkpoint.pendingPlan.original.actionId ||
      rows[0].value?.withdrawn !== true ||
      rows[0].value?.roleOid !== this.#roleOid
    )
      throw new PrivateNativeActionUnavailable();
    this.#withdrawn = true;
  }
  async observe(): Promise<PrivateStockNativeObservation> {
    this.assertCheckpoint(this.checkpoint);
    if (!this.#withdrawn || this.#business?.isInitialized)
      throw new PrivateNativeActionUnavailable();
    await this.checkpoint.assertCurrent();
    await this.assertCatalog();
    await this.checkpoint.assertCurrent();
    const rows: unknown = await this.parent.query(
      'SELECT core.observe_original_stock_workspace() AS value',
    );
    await this.checkpoint.assertCurrent();
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      Object.keys(rows[0]).length !== 1 ||
      !rows[0].value ||
      typeof rows[0].value !== 'object' ||
      Array.isArray(rows[0].value)
    )
      throw new PrivateNativeActionUnavailable();
    const value = rows[0].value as Record<string, unknown>;
    const original = this.checkpoint.pendingPlan.original;
    if (
      Object.keys(value).sort().join(',') !== OBSERVATION_KEYS.join(',') ||
      value.actionId !== original.actionId ||
      value.workspaceId !== original.workspaceId ||
      value.userId !== original.userId ||
      value.userWorkspaceId !== original.userWorkspaceId ||
      value.customApplicationId !== original.customApplicationId ||
      value.schemaName !== getWorkspaceSchemaName(original.workspaceId) ||
      value.setupRemoved !== true ||
      !['workspaceMemberId', 'roleId', 'standardApplicationId'].every(
        (key) => typeof value[key] === 'string' && UUID.test(value[key]),
      ) ||
      value.standardApplicationId === value.customApplicationId ||
      !value.recordRoles ||
      typeof value.recordRoles !== 'object' ||
      Object.keys(value.recordRoles).sort().join(',') !==
        'companyObjectMetadataId,personObjectMetadataId,readerRoleId,writerRoleId' ||
      !Object.values(value.recordRoles).every(
        (identifier) => typeof identifier === 'string' && UUID.test(identifier),
      ) ||
      new Set(Object.values(value.recordRoles)).size !== 4
    )
      throw new PrivateNativeActionUnavailable();
    const recordRoles = value.recordRoles as Record<string, string>;
    if (
      recordRoles.readerRoleId !==
        v5('private-native-stock-record-reader-role-v1', original.actionId) ||
      recordRoles.writerRoleId !==
        v5('private-native-stock-record-writer-role-v1', original.actionId)
    )
      throw new PrivateNativeActionUnavailable();
    // This DTO covers independently observed SQL state only. Filesystem bytes and
    // SDK archive hashes require separate current-action observation before readiness.
    await this.checkpoint.assertCurrent();
    return Object.freeze({
      ...value,
      recordRoles: Object.freeze({ ...recordRoles }),
    }) as PrivateStockNativeObservation;
  }
}
