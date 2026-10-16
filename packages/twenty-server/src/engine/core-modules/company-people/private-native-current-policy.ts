export const PRIVATE_NATIVE_CURRENT_ROLE = 'exe_crm_native_current_reader';
export const PRIVATE_NATIVE_CURRENT_FUNCTION =
  'core.lock_original_crm_current_identity(jsonb)';
export const PRIVATE_NATIVE_CURRENT_TABLES = [
  'privateNativeAction',
  'privateNativeWorkspaceBinding',
  'privateNativeIdentityActivation',
  'workspace',
  'user',
  'userWorkspace',
  'application',
  'role',
  'roleTarget',
  'objectMetadata',
  'objectPermission',
  'fieldPermission',
  'permissionFlag',
  'rowLevelPermissionPredicate',
  'rowLevelPermissionPredicateGroup',
] as const;
const tables = PRIVATE_NATIVE_CURRENT_TABLES.map(
  (table) => `core."${table}"`,
).join(',');

// The reader receives no UPDATE privilege. This exact, separately admitted
// helper owns only lock acquisition; all correspondence is independently read.
export const PRIVATE_NATIVE_CURRENT_BODY = String.raw`
DECLARE
  original core."privateNativeAction"%ROWTYPE;
  activation core."privateNativeIdentityActivation"%ROWTYPE;
  native_schema text;
  member_id uuid;
BEGIN
  IF current_user<>'crm_setup_operator' OR session_user<>'exe_crm_native_current_reader' OR
    jsonb_typeof(expected) IS DISTINCT FROM 'object' OR
    ARRAY(SELECT key FROM jsonb_object_keys(expected) key ORDER BY key)<>
      ARRAY['actionId','companyId','databaseAssociationSha256','profileSha256','requestId','subjectId','workspaceId']::text[] OR
    EXISTS(SELECT 1 FROM jsonb_each(expected) item WHERE jsonb_typeof(item.value)<>'string') THEN
    RAISE EXCEPTION 'Private native current isolation unavailable' USING ERRCODE='55000';
  END IF;
  LOCK TABLE ${tables} IN SHARE MODE;
  SELECT * INTO STRICT original FROM core."privateNativeAction"
    WHERE "actionId"=(expected->>'actionId')::uuid FOR SHARE;
  SELECT * INTO STRICT activation FROM core."privateNativeIdentityActivation"
    WHERE "requestId"=(expected->>'requestId')::uuid FOR SHARE;
  IF (SELECT count(*) FROM core."privateNativeAction")<>1 OR
    original."companyId"<>(expected->>'companyId')::uuid OR
    original."ownerSubject"<>(expected->>'subjectId')::uuid OR
    original."plannedWorkspaceId"<>(expected->>'workspaceId')::uuid OR
    original."profileSha256"<>expected->>'profileSha256' OR
    activation."companyId"<>original."companyId" OR activation."subjectId"<>original."ownerSubject" OR
    activation."workspaceId"<>original."plannedWorkspaceId" OR
    activation."userId"<>original."plannedUserId" OR
    activation."userWorkspaceId"<>original."plannedUserWorkspaceId" OR
    activation."profileSha256"<>expected->>'profileSha256' OR
    activation."databaseAssociationSha256"<>expected->>'databaseAssociationSha256' OR
    NOT EXISTS(SELECT 1 FROM core."privateNativeWorkspaceBinding" b
      WHERE b."actionId"=original."actionId" AND b."workspaceId"=original."plannedWorkspaceId"
        AND b."userId"=original."plannedUserId" AND b."userWorkspaceId"=original."plannedUserWorkspaceId") THEN
    RAISE EXCEPTION 'Private native current isolation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT "databaseSchema" INTO STRICT native_schema FROM core.workspace
    WHERE id=activation."workspaceId" AND "activationStatus"='ACTIVE'
      AND "deletedAt" IS NULL AND "suspendedAt" IS NULL FOR SHARE;
  IF native_schema !~ '^workspace_[0-9a-z]{1,25}$' THEN
    RAISE EXCEPTION 'Private native current isolation unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('LOCK TABLE %I."workspaceMember" IN SHARE MODE',native_schema);
  PERFORM 1 FROM core."user" WHERE id=activation."userId" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private native current isolation unavailable'; END IF;
  PERFORM 1 FROM core."userWorkspace" WHERE id=activation."userWorkspaceId" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private native current isolation unavailable'; END IF;
  PERFORM 1 FROM core."roleTarget" WHERE "userWorkspaceId"=activation."userWorkspaceId" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private native current isolation unavailable'; END IF;
  PERFORM 1 FROM core.role WHERE id=activation."roleId" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private native current isolation unavailable'; END IF;
  EXECUTE format('SELECT id FROM %I."workspaceMember" WHERE id=$1 AND "userId"=$2 FOR SHARE',native_schema)
    INTO STRICT member_id USING activation."workspaceMemberId",activation."userId";
  RETURN true;
END
`;
