import { type DataSource } from 'typeorm';

import {
  PRIVATE_NATIVE_LOCK_BODY,
  PRIVATE_NATIVE_LOCK_OWNER,
  PRIVATE_NATIVE_LOCK_SIGNATURE,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-lock-policy';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

// Fresh catalog checks on the actual native connection, never an injected
// authority callback. Core's independent function-only guard remains separate.
export class PrivateNativeDatabaseGuard {
  constructor(
    private readonly database: DataSource,
    private readonly role: string,
    private readonly readOnly: boolean,
  ) {}

  async assertCurrent(): Promise<void> {
    const rows = await this.database
      .query(`SELECT session_user AS login,current_user AS effective,
      r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS member,
      has_database_privilege(session_user,current_database(),'CREATE') AS creates_database_objects,
      has_database_privilege(session_user,current_database(),'TEMP') AS temporary_objects,
      EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) AS database_owner
      FROM pg_roles r WHERE r.rolname=session_user`);
    if (
      rows.length !== 1 ||
      rows[0].login !== this.role ||
      rows[0].effective !== this.role ||
      [
        'rolsuper',
        'rolbypassrls',
        'rolcreaterole',
        'rolcreatedb',
        'rolreplication',
        'member',
        'creates_database_objects',
        'temporary_objects',
        'database_owner',
      ].some((key) => rows[0][key] !== false)
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    const allowedReads = this.readOnly
      ? [
          'privateNativeAction',
          'privateNativeWorkspaceBinding',
          'workspace',
          'user',
          'userWorkspace',
        ]
      : [
          'privateNativeAction',
          'privateNativeWorkspaceBinding',
          'workspace',
          'user',
          'userWorkspace',
          'application',
          'file',
        ];
    const allowedUpdates = this.readOnly
      ? []
      : [
          ...[
            'packageJsonFileId',
            'yarnLockFileId',
            'packageJsonChecksum',
            'yarnLockChecksum',
            'availablePackages',
            'updatedAt',
          ].map((column) => ['application', column]),
          ...['size', 'settings', 'updatedAt'].map((column) => [
            'file',
            column,
          ]),
        ];
    const helper = await this.database.query(
      `SELECT p.oid::text AS oid,
      p.prosrc=$1::text AND p.prosecdef AND p.provolatile='v' AND p.prorettype='void'::regtype
        AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AS body_matches,
      r.rolname=$2::text AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
        AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolinherit
        AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid OR
          (n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(r.oid,n.oid,'CREATE')))
        AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datdba=r.oid)
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
        AND NOT EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND t.typowner=r.oid)
        AND NOT EXISTS(SELECT 1 FROM pg_proc other JOIN pg_namespace n ON n.oid=other.pronamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND other.oid<>p.oid
            AND (other.proowner=r.oid OR (other.prosecdef AND has_function_privilege(r.oid,other.oid,'EXECUTE'))))
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND CASE
            WHEN c.relkind='S' THEN has_sequence_privilege(r.oid,c.oid,'USAGE') OR
              has_sequence_privilege(r.oid,c.oid,'SELECT') OR has_sequence_privilege(r.oid,c.oid,'UPDATE')
            WHEN c.relkind IN ('r','p','v','m','f') THEN
              has_any_column_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'DELETE') OR
              has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'TRIGGER') OR
              has_any_column_privilege(r.oid,c.oid,'REFERENCES') OR
              (has_any_column_privilege(r.oid,c.oid,'SELECT') AND NOT(n.nspname='core' AND
                c.relname=ANY(ARRAY['workspace','user','privateNativeAction']::text[]))) OR
              (has_any_column_privilege(r.oid,c.oid,'UPDATE') AND NOT(n.nspname='core' AND
                c.relname=ANY(ARRAY['workspace','user']::text[])))
            ELSE false END) AS owner_matches,
      NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_denied,
      has_function_privilege(session_user,p.oid,'EXECUTE') AS executable
      FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure($3::text)`,
      [
        PRIVATE_NATIVE_LOCK_BODY,
        PRIVATE_NATIVE_LOCK_OWNER,
        PRIVATE_NATIVE_LOCK_SIGNATURE,
      ],
    );
    if (
      helper.length !== 1 ||
      helper[0].body_matches !== true ||
      helper[0].owner_matches !== true ||
      helper[0].public_denied !== true ||
      helper[0].executable !== !this.readOnly ||
      typeof helper[0].oid !== 'string' ||
      !/^[1-9][0-9]*$/.test(helper[0].oid)
    ) {
      throw new PrivateNativeActionUnavailable();
    }
    const policy = await this.database.query(
      `SELECT
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
        AND (n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=session_user) OR
          has_schema_privilege(session_user,n.oid,'CREATE'))) AS schema_authority,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
          c.relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user) OR
          CASE WHEN c.relkind='S' THEN
            has_sequence_privilege(session_user,c.oid,'USAGE') OR
            has_sequence_privilege(session_user,c.oid,'SELECT') OR has_sequence_privilege(session_user,c.oid,'UPDATE')
          WHEN c.relkind IN ('r','p','v','m','f') THEN
            has_table_privilege(session_user,c.oid,'DELETE') OR has_table_privilege(session_user,c.oid,'TRUNCATE') OR
            has_table_privilege(session_user,c.oid,'TRIGGER') OR
            (NOT(n.nspname='core' AND c.relname=ANY($1::text[])) AND
              (has_any_column_privilege(session_user,c.oid,'SELECT') OR has_any_column_privilege(session_user,c.oid,'INSERT') OR
                has_any_column_privilege(session_user,c.oid,'UPDATE') OR has_any_column_privilege(session_user,c.oid,'REFERENCES')))
          ELSE false END)) AS object_authority,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (
          p.proowner=(SELECT oid FROM pg_roles WHERE rolname=session_user) OR
          (p.prosecdef AND has_function_privilege(session_user,p.oid,'EXECUTE') AND NOT ($4::boolean AND p.oid=$5::oid)))) AS routine_authority,
      EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
          AND t.typowner=(SELECT oid FROM pg_roles WHERE rolname=session_user)) AS type_authority,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        WHERE n.nspname='core' AND c.relkind IN ('r','p','v','m','f') AND (
          (has_column_privilege(session_user,c.oid,a.attnum,'SELECT') AND NOT c.relname=ANY($1::text[])) OR
          (has_column_privilege(session_user,c.oid,a.attnum,'INSERT') AND NOT c.relname=ANY($2::text[])) OR
          has_column_privilege(session_user,c.oid,a.attnum,'REFERENCES') OR
          (has_column_privilege(session_user,c.oid,a.attnum,'UPDATE') AND NOT EXISTS(
            SELECT 1 FROM jsonb_array_elements($3::jsonb) p WHERE p->>0=c.relname AND p->>1=a.attname)))) AS column_authority`,
      [
        allowedReads,
        this.readOnly ? [] : allowedReads,
        JSON.stringify(allowedUpdates),
        !this.readOnly,
        helper[0].oid,
      ],
    );
    if (
      policy.length !== 1 ||
      [
        'schema_authority',
        'object_authority',
        'routine_authority',
        'type_authority',
        'column_authority',
      ].some((key) => policy[0][key] !== false)
    ) {
      throw new PrivateNativeActionUnavailable();
    }
  }
}
