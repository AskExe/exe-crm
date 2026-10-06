export const PRIVATE_PEOPLE_LOCK_OWNER = 'crm_private_people_policy_lock';
export const PRIVATE_PEOPLE_POLICY_TABLES = [
  'workspace',
  'user',
  'userWorkspace',
  'roleTarget',
  'role',
  'objectPermission',
  'fieldPermission',
  'objectMetadata',
  'fieldMetadata',
  'rowLevelPermissionPredicate',
  'rowLevelPermissionPredicateGroup',
] as const;
export const PRIVATE_PEOPLE_POLICY_SQL = PRIVATE_PEOPLE_POLICY_TABLES.map(
  (table) => `core."${table}"`,
).join(',');

// Exact pg_proc.prosrc admission, including its fixed whitespace.
export const PRIVATE_PEOPLE_LOCK_BODY = ` DECLARE b record; native_schema text; BEGIN
          IF rid IS NULL OR EXISTS(SELECT 1 FROM core."privatePeopleRequest" WHERE "requestId"=rid) THEN
            RAISE EXCEPTION 'Private people request unavailable';
          END IF;
          SELECT * INTO STRICT b FROM core."privatePeopleOperatorBinding"
            WHERE "workspaceId"=wid AND "subjectId"=sid AND "companyId"=cid
              AND "bindingId"=bid AND "generationId"=gid AND "clientId"=client
              AND audience=aud AND "userId"=uid AND "userWorkspaceId"=uwid
              AND "workspaceMemberId"=mid;
          LOCK TABLE ${PRIVATE_PEOPLE_POLICY_SQL} IN SHARE MODE;
          SELECT "databaseSchema" INTO STRICT native_schema FROM core.workspace
            WHERE id=wid AND "activationStatus"='ACTIVE' AND "suspendedAt" IS NULL AND "deletedAt" IS NULL;
          IF native_schema !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
            RAISE EXCEPTION 'Private people schema unavailable';
          END IF;
          -- Exact workspace-member table only; the operator must separately
          -- grant this helper owner USAGE/SELECT/UPDATE on that bound surface.
          -- The business login gets SELECT, never UPDATE or helper membership.
          EXECUTE format('LOCK TABLE %I."workspaceMember" IN SHARE MODE',native_schema);
          IF NOT EXISTS(SELECT 1 FROM core."roleTarget" WHERE "workspaceId"=wid
            AND "userWorkspaceId"=uwid AND "roleId"=b."roleId") THEN
            RAISE EXCEPTION 'Private people role unavailable';
          END IF;
        END;`;
