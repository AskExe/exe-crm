// Unmounted material for the separate final activation credential. Installing
// this body and admitting its exact owner/ACL are separate operator actions.
// Core holds its fresh authority locks while invoking the fixed operation.
export const PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY = String.raw`
DECLARE
  original core."privateNativeAction"%ROWTYPE;
  workspace core.workspace%ROWTYPE;
  subject_user core."user"%ROWTYPE;
  membership core."userWorkspace"%ROWTYPE;
  target core."roleTarget"%ROWTYPE;
  reader_role uuid; writer_role uuid; selected_role uuid;
  person_object uuid; company_object uuid; standard_application uuid; setup_user uuid;
  member_id uuid; member_count bigint; native_schema text;
  schema_integer numeric; schema_remainder integer; schema_suffix text := '';
  payload jsonb; scopes text[]; write_allowed boolean;
  ack_text text; receipt_text text; ack_bytes bytea; receipt_bytes bytea;
BEGIN
  IF current_user<>'crm_setup_operator' OR (SELECT oid FROM pg_roles WHERE rolname=current_user)<>10 OR
     session_user<>'exe_crm_native_identity_activator' OR
     NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
       AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolcreatedb AND NOT r.rolcreaterole
       AND NOT r.rolreplication AND NOT r.rolbypassrls
       AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)) THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  IF request IS NULL OR canonical_payload IS NULL OR jsonb_typeof(request) IS DISTINCT FROM 'object' OR
    ARRAY(SELECT key FROM jsonb_object_keys(request) key ORDER BY key) <>
    ARRAY['action_id','attempt','audience','authz_epoch','binding_id','client_id','company_id',
      'coordinator_id','database_association_sha256','expires_at','generation_id','identity_sha256',
      'native_id','parent_exp','parent_session_id','payload_sha256','policy_revision','profile_sha256',
      'request_id','subject_id']::text[] OR
    octet_length(canonical_payload) NOT BETWEEN 1 AND 4096 OR
    request->>'attempt'<>'1' OR request->>'coordinator_id' !~ '^[a-z][a-z0-9_-]{2,63}$' OR
    request->>'authz_epoch' !~ '^[1-9][0-9]{0,18}$' OR
    request->>'parent_exp' !~ '^[1-9][0-9]{0,18}$' OR
    request->>'policy_revision' !~ '^[1-9][0-9]{0,18}$' OR
    request->>'client_id' !~ '^[a-z][a-z0-9_-]{2,63}$' OR
    request->>'audience' !~ '^[a-z][a-z0-9_-]{2,63}$' OR
    EXISTS(SELECT 1 FROM jsonb_each(request) item WHERE jsonb_typeof(item.value)<>'string') OR
    EXISTS(SELECT 1 FROM unnest(ARRAY['payload_sha256','identity_sha256','profile_sha256','database_association_sha256']) key
      WHERE request->>key !~ '^[a-f0-9]{64}$') OR
    EXISTS(SELECT 1 FROM unnest(ARRAY['action_id','binding_id','company_id','generation_id','native_id','parent_session_id','request_id','subject_id']) key
      WHERE request->>key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') OR
    encode(sha256(canonical_payload),'hex')<>request->>'payload_sha256' THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  payload:=convert_from(canonical_payload,'UTF8')::jsonb;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR
    ARRAY(SELECT key FROM jsonb_object_keys(payload) key ORDER BY key)<>
      ARRAY['activation_scopes','email_confirmed_at','identity_sha256','subject_id','verified_email']::text[] OR
    payload->>'subject_id' IS DISTINCT FROM request->>'subject_id' OR
    payload->>'identity_sha256' IS DISTINCT FROM request->>'identity_sha256' OR
    jsonb_typeof(payload->'verified_email')<>'string' OR length(payload->>'verified_email') NOT BETWEEN 3 AND 320 OR
    jsonb_typeof(payload->'email_confirmed_at') IS DISTINCT FROM 'string' OR
    length(payload->>'email_confirmed_at') NOT BETWEEN 1 AND 64 OR
    (payload->>'email_confirmed_at')::timestamptz>clock_timestamp() OR
    payload->'activation_scopes' IS NULL OR payload->'activation_scopes' NOT IN ('["crm:read"]'::jsonb,'["crm:read","crm:write"]'::jsonb) OR
    clock_timestamp()>=(request->>'expires_at')::timestamptz OR
    (request->>'expires_at')::timestamptz>clock_timestamp()+interval '5 seconds' THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  -- The isolated company database keeps these fixed table locks short. They
  -- prevent phantom extra assignments or permission rows during correspondence.
  LOCK TABLE core."privateNativeAction",core."privateNativeWorkspaceBinding",core.workspace,
    core."user",core."userWorkspace",core."appToken",core.application,core.role,core."roleTarget",core."objectMetadata",
    core."objectPermission",core."fieldPermission",core."permissionFlag",core."rowLevelPermissionPredicate",
    core."rowLevelPermissionPredicateGroup",core."privateNativeIdentityActivation" IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT original FROM core."privateNativeAction"
    WHERE "actionId"=(request->>'action_id')::uuid;
  IF (SELECT count(*) FROM core."privateNativeAction")<>1 OR
    original."companyId"<>(request->>'company_id')::uuid OR
    original."ownerSubject"<>(request->>'subject_id')::uuid OR
    original."plannedWorkspaceId"<>(request->>'native_id')::uuid OR
    NOT EXISTS(SELECT 1 FROM core."privateNativeWorkspaceBinding" b WHERE b."actionId"=original."actionId"
      AND b."workspaceId"=original."plannedWorkspaceId" AND b."userId"=original."plannedUserId"
      AND b."userWorkspaceId"=original."plannedUserWorkspaceId") THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  setup_user:=public.uuid_generate_v5(original."actionId",'private-native-stock-setup-user-v1');
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='exe_crm_native_stock_provisioner') OR
    EXISTS(SELECT 1 FROM core."userWorkspace" WHERE "userId"=setup_user) OR
    EXISTS(SELECT 1 FROM core."appToken" WHERE "userId"=setup_user) OR
    NOT EXISTS(SELECT 1 FROM core."user" WHERE id=setup_user AND disabled=true AND "deletedAt" IS NOT NULL
      AND "isEmailVerified"=false AND "passwordHash" IS NULL AND "canImpersonate"=false AND "canAccessFullAdminPanel"=false) THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT workspace FROM core.workspace WHERE id=original."plannedWorkspaceId" FOR UPDATE;
  IF workspace."activationStatus"<>'ACTIVE' OR workspace."databaseSchema" IS NULL OR
     workspace."deletedAt" IS NOT NULL OR workspace."suspendedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  schema_integer:=0;
  FOR schema_remainder IN 0..15 LOOP
    schema_integer:=schema_integer*256+get_byte(decode(replace(workspace.id::text,'-',''),'hex'),schema_remainder);
  END LOOP;
  WHILE schema_integer>0 LOOP
    schema_remainder:=mod(schema_integer,36)::integer;
    schema_suffix:=substr('0123456789abcdefghijklmnopqrstuvwxyz',schema_remainder+1,1)||schema_suffix;
    schema_integer:=div(schema_integer,36);
  END LOOP;
  native_schema:='workspace_'||COALESCE(NULLIF(schema_suffix,''),'0');
  IF workspace."databaseSchema"<>native_schema THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  IF native_schema !~ '^workspace_[0-9a-z]{1,25}$' OR NOT EXISTS(
    SELECT 1 FROM pg_namespace WHERE nspname=native_schema) THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('LOCK TABLE %I."workspaceMember" IN SHARE ROW EXCLUSIVE MODE',native_schema);
  EXECUTE format('SELECT count(*) FROM %I."workspaceMember" WHERE "userId"=$1',native_schema)
    INTO member_count USING setup_user;
  IF member_count<>0 THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT subject_user FROM core."user" WHERE id=original."plannedUserId" FOR UPDATE;
  SELECT * INTO STRICT membership FROM core."userWorkspace" WHERE id=original."plannedUserWorkspaceId" FOR UPDATE;
  IF subject_user.disabled OR subject_user."deletedAt" IS NOT NULL OR subject_user."passwordHash" IS NOT NULL OR
    subject_user."canImpersonate" OR subject_user."canAccessFullAdminPanel" OR
    membership."userId"<>subject_user.id OR membership."workspaceId"<>workspace.id OR membership."deletedAt" IS NOT NULL OR
    (SELECT count(*) FROM core."userWorkspace" WHERE "userId"=subject_user.id AND "deletedAt" IS NULL)<>1 OR
    (SELECT count(*) FROM core."roleTarget" WHERE "userWorkspaceId"=membership.id)<>1 THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT target FROM core."roleTarget" WHERE "userWorkspaceId"=membership.id FOR UPDATE;
  EXECUTE format('SELECT count(*),min(id::text)::uuid FROM %I."workspaceMember" WHERE "userId"=$1 AND "deletedAt" IS NULL',native_schema)
    INTO member_count,member_id USING subject_user.id;
  IF member_count<>1 OR target."workspaceId"<>workspace.id OR target."agentId" IS NOT NULL OR target."apiKeyId" IS NOT NULL THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  reader_role:=public.uuid_generate_v5(original."actionId",'private-native-stock-record-reader-role-v1');
  writer_role:=public.uuid_generate_v5(original."actionId",'private-native-stock-record-writer-role-v1');
  scopes:=ARRAY(SELECT jsonb_array_elements_text(payload->'activation_scopes'));
  write_allowed:=cardinality(scopes)=2;
  selected_role:=CASE WHEN write_allowed THEN writer_role ELSE reader_role END;
  SELECT id INTO STRICT standard_application FROM core.application WHERE "workspaceId"=workspace.id
    AND "universalIdentifier"='20202020-64aa-4b6f-b003-9c74b97cee20' AND "deletedAt" IS NULL;
  SELECT id INTO STRICT person_object FROM core."objectMetadata" WHERE "workspaceId"=workspace.id AND "applicationId"=standard_application
    AND "nameSingular"='person' AND "universalIdentifier"='20202020-e674-48e5-a542-72570eee7213' AND "isSystem"=false;
  SELECT id INTO STRICT company_object FROM core."objectMetadata" WHERE "workspaceId"=workspace.id AND "applicationId"=standard_application
    AND "nameSingular"='company' AND "universalIdentifier"='20202020-b374-4779-a561-80086cb2e17f' AND "isSystem"=false;
  IF person_object=company_object OR
    (SELECT count(*) FROM core.role WHERE id IN(reader_role,writer_role) AND "workspaceId"=workspace.id
      AND "applicationId"=original."plannedApplicationId" AND "isEditable"=false
      AND label=CASE WHEN id=reader_role THEN 'Company record reader' ELSE 'Company record writer' END
      AND "universalIdentifier"=public.uuid_generate_v5(original."actionId",CASE WHEN id=reader_role THEN
        'private-native-stock-record-reader-role-universal-v1' ELSE 'private-native-stock-record-writer-role-universal-v1' END)
      AND "canBeAssignedToUsers"=true AND "canBeAssignedToAgents"=false AND "canBeAssignedToApiKeys"=false
      AND "canReadAllObjectRecords"=false AND "canUpdateAllObjectRecords"=false AND "canSoftDeleteAllObjectRecords"=false
      AND "canDestroyAllObjectRecords"=false AND "canUpdateAllSettings"=false AND "canAccessAllTools"=false)<>2 OR
    (SELECT count(*) FROM core."objectPermission" WHERE "roleId" IN(reader_role,writer_role))<>4 OR
    (SELECT count(DISTINCT ("roleId","objectMetadataId")) FROM core."objectPermission" WHERE "roleId" IN(reader_role,writer_role))<>4 OR
    (SELECT count(*) FROM core."objectPermission" WHERE "roleId" IN(reader_role,writer_role)
      AND "workspaceId"=workspace.id AND "applicationId"=original."plannedApplicationId"
      AND "objectMetadataId" IN(person_object,company_object) AND "canReadObjectRecords"=true
      AND "canUpdateObjectRecords"=("roleId"=writer_role) AND "canSoftDeleteObjectRecords"=false AND "canDestroyObjectRecords"=false)<>4 OR
    EXISTS(SELECT 1 FROM core."roleTarget" WHERE "roleId" IN(reader_role,writer_role)
      AND ("userWorkspaceId" IS DISTINCT FROM membership.id OR "workspaceId"<>workspace.id OR "agentId" IS NOT NULL OR "apiKeyId" IS NOT NULL)) OR
    EXISTS(SELECT 1 FROM core."fieldPermission" WHERE "roleId" IN(reader_role,writer_role)) OR
    EXISTS(SELECT 1 FROM core."permissionFlag" WHERE "roleId" IN(reader_role,writer_role)) OR
    EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicate" WHERE "roleId" IN(reader_role,writer_role)) OR
    EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicateGroup" WHERE "roleId" IN(reader_role,writer_role)) OR
    (target."roleId" NOT IN(reader_role,writer_role) AND NOT EXISTS(SELECT 1 FROM core.role r WHERE r.id=target."roleId"
      AND r."workspaceId"=workspace.id AND r."applicationId"=original."plannedApplicationId" AND r.label='Guest'
      AND r."canReadAllObjectRecords"=true AND r."canUpdateAllObjectRecords"=false
      AND r."canSoftDeleteAllObjectRecords"=false AND r."canDestroyAllObjectRecords"=false
      AND r."canUpdateAllSettings"=false AND r."canAccessAllTools"=false
      AND r."canBeAssignedToUsers"=true AND r."canBeAssignedToAgents"=false AND r."canBeAssignedToApiKeys"=false
      AND NOT EXISTS(SELECT 1 FROM core."fieldPermission" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."permissionFlag" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicate" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicateGroup" WHERE "roleId"=r.id))) THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  -- Only the original identity and its one existing assignment are changed.
  -- No RoleService, metadata migration, onboarding, schema or member creation.
  UPDATE core."user" SET email=payload->>'verified_email',"isEmailVerified"=true WHERE id=subject_user.id;
  UPDATE core."roleTarget" SET "roleId"=selected_role,"updatedAt"=clock_timestamp() WHERE id=target.id;
  ack_text:=format('{"request_id":%s,"company_id":%s,"subject_id":%s,"workspace_id":%s,"identity_sha256":%s,"parent_session_id":%s,"parent_exp":%s,"user_id":%s,"user_workspace_id":%s,"workspace_member_id":%s,"role_id":%s,"commit":"acknowledged"}',
    to_json(request->>'request_id'),to_json(request->>'company_id'),to_json(request->>'subject_id'),to_json(workspace.id::text),
    to_json(request->>'identity_sha256'),to_json(request->>'parent_session_id'),to_json(request->>'parent_exp'),
    to_json(subject_user.id::text),to_json(membership.id::text),to_json(member_id::text),to_json(selected_role::text));
  receipt_text:=format('[%s,%s,%s]',to_json(request->>'request_id'),to_json(request->>'payload_sha256'),ack_text);
  ack_bytes:=convert_to(ack_text,'UTF8');receipt_bytes:=convert_to(receipt_text,'UTF8');
  IF clock_timestamp()>=(request->>'expires_at')::timestamptz THEN
    RAISE EXCEPTION 'Native editor activation unavailable' USING ERRCODE='55000';
  END IF;
  INSERT INTO core."privateNativeIdentityActivation"("requestId","companyId","subjectId","workspaceId","clientId","bindingId","generationId",
    "authzEpoch",audience,action,"policyRevision","payloadSha256","identitySha256","parentSessionId","parentExp",attempt,"coordinatorId",
    "profileSha256","databaseAssociationSha256","userId","userWorkspaceId","workspaceMemberId","roleId","expiresAt","cleanupExpiresAt",
    "ackUtf8","ackSha256","receiptInputUtf8","receiptSha256","activationVersion","activationScopes")
  VALUES((request->>'request_id')::uuid,(request->>'company_id')::uuid,(request->>'subject_id')::uuid,workspace.id,
    request->>'client_id',(request->>'binding_id')::uuid,(request->>'generation_id')::uuid,request->>'authz_epoch',request->>'audience',
    'crm:native-identity:activate',request->>'policy_revision',request->>'payload_sha256',request->>'identity_sha256',
    (request->>'parent_session_id')::uuid,request->>'parent_exp',1,request->>'coordinator_id',request->>'profile_sha256',
    request->>'database_association_sha256',subject_user.id,membership.id,member_id,selected_role,
    (request->>'expires_at')::timestamptz,(request->>'expires_at')::timestamptz+interval '60 seconds',
    ack_bytes,encode(sha256(ack_bytes),'hex'),receipt_bytes,encode(sha256(receipt_bytes),'hex'),2,scopes);
  RETURN jsonb_build_object('ackUtf8',encode(ack_bytes,'base64'),'receiptInputUtf8',encode(receipt_bytes,'base64'));
END
`;
