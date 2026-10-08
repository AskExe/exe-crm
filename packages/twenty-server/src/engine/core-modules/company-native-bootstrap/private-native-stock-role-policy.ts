import { createHash } from 'node:crypto';

import {
  PRIVATE_NATIVE_STOCK_RELATIONS,
  PRIVATE_NATIVE_STOCK_READ_RELATIONS,
  PRIVATE_NATIVE_STOCK_ROLE,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';

export const PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER = 'crm_setup_operator';
export const PRIVATE_NATIVE_STOCK_PARENT_ROLE = 'exe_crm_native_stock_parent';

// Uninstalled source proposal. No migration, installer, CLI or grant invocation.
// All no-argument bodies require an independently pinned OID10 owner/ACL,
// original-action parent fence and secret-only result channel before use.
export const PRIVATE_NATIVE_STOCK_BEGIN_BODY = `
DECLARE
  a core."privateNativeAction"%ROWTYPE;
  w core.workspace%ROWTYPE;
  secret text;
  relation_name text;
  setup_oid oid;
  numeric_uuid numeric := 0;
  digit integer;
  hex_uuid text;
  base36 text := '';
  schema_name text;
  i integer;
BEGIN
  IF current_user<>'${PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER}' OR
    (SELECT oid FROM pg_roles WHERE rolname=current_user)<>10 OR
    (SELECT count(*) FROM core."privateNativeAction")<>1 OR
    (SELECT count(*) FROM core.workspace)<>1 OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_STOCK_ROLE}') THEN
    RAISE EXCEPTION 'Stock setup unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT a FROM core."privateNativeAction";
  hex_uuid:=replace(a."plannedWorkspaceId"::text,'-','');
  FOR i IN 1..32 LOOP
    digit:=strpos('0123456789abcdef',substr(hex_uuid,i,1))-1;
    IF digit<0 THEN RAISE EXCEPTION 'Stock setup unavailable' USING ERRCODE='55000'; END IF;
    numeric_uuid:=numeric_uuid*16+digit;
  END LOOP;
  WHILE numeric_uuid>0 LOOP
    digit:=mod(numeric_uuid,36)::integer;
    base36:=substr('0123456789abcdefghijklmnopqrstuvwxyz',digit+1,1)||base36;
    numeric_uuid:=pg_catalog.div(numeric_uuid,36);
  END LOOP;
  IF base36='' THEN base36:='0'; END IF;
  schema_name:='workspace_'||base36;
  SELECT * INTO STRICT w FROM core.workspace WHERE id=a."plannedWorkspaceId";
  IF w."activationStatus"<>'PENDING_CREATION' OR w."databaseSchema" IS NOT NULL OR
     w."deletedAt" IS NOT NULL OR w."suspendedAt" IS NOT NULL OR
     w."workspaceCustomApplicationId" IS DISTINCT FROM a."plannedApplicationId" OR
     NOT EXISTS(SELECT 1 FROM core."privateNativeWorkspaceBinding" b
       WHERE b."actionId"=a."actionId" AND b."workspaceId"=w.id
       AND b."userId"=a."plannedUserId" AND b."userWorkspaceId"=a."plannedUserWorkspaceId") OR
     EXISTS(SELECT 1 FROM core."dataSource" WHERE "workspaceId"=w.id) OR
     EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=schema_name) OR
     (SELECT count(*) FROM core."user")<>1 OR
     (SELECT count(*) FROM core."userWorkspace")<>1 OR
     NOT EXISTS(SELECT 1 FROM core."user" u WHERE u.id=a."plannedUserId"
       AND u.email='subject-'||a."ownerSubject"::text||'@native.invalid'
       AND u.disabled=false AND u."deletedAt" IS NULL AND u."isEmailVerified"=false
       AND u."passwordHash" IS NULL AND u."canImpersonate"=false AND u."canAccessFullAdminPanel"=false) OR
     NOT EXISTS(SELECT 1 FROM core."userWorkspace" uw WHERE uw.id=a."plannedUserWorkspaceId"
       AND uw."userId"=a."plannedUserId" AND uw."workspaceId"=w.id AND uw."deletedAt" IS NULL) THEN
    RAISE EXCEPTION 'Stock setup unavailable' USING ERRCODE='55000';
  END IF;
  secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  EXECUTE format('CREATE ROLE ${PRIVATE_NATIVE_STOCK_ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD %L VALID UNTIL %L',
    secret,(clock_timestamp()+interval '120 seconds')::text);
  SELECT oid INTO STRICT setup_oid FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_STOCK_ROLE}';
  EXECUTE format('COMMENT ON ROLE ${PRIVATE_NATIVE_STOCK_ROLE} IS %L',
    'private-native-stock-v1:'||a."actionId"::text);
  IF EXISTS(SELECT 1 FROM pg_database d WHERE d.datname<>current_database()
      AND has_database_privilege(setup_oid,d.oid,'CONNECT')) OR
     has_database_privilege(setup_oid,current_database(),'TEMP') THEN
    -- Isolation prerequisites are never repaired by revoking PUBLIC privileges
    -- from foreign databases or ordinary roles in this function.
    RAISE EXCEPTION 'Stock setup unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT CONNECT,CREATE ON DATABASE %I TO ${PRIVATE_NATIVE_STOCK_ROLE}',current_database());
  GRANT USAGE ON SCHEMA core TO ${PRIVATE_NATIVE_STOCK_ROLE};
  FOREACH relation_name IN ARRAY ARRAY[${PRIVATE_NATIVE_STOCK_RELATIONS.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE core.%I TO ${PRIVATE_NATIVE_STOCK_ROLE}',relation_name);
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[${PRIVATE_NATIVE_STOCK_READ_RELATIONS.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE core.%I TO ${PRIVATE_NATIVE_STOCK_ROLE}',relation_name);
  END LOOP;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${PRIVATE_NATIVE_STOCK_ROLE} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${PRIVATE_NATIVE_STOCK_ROLE} REVOKE USAGE ON TYPES FROM PUBLIC;
  RETURN jsonb_build_object('actionId',a."actionId",'role','${PRIVATE_NATIVE_STOCK_ROLE}',
    'roleOid',setup_oid::text,'database',current_database(),'password',secret);
END
`;

export const PRIVATE_NATIVE_STOCK_DISABLE_BODY = `
DECLARE
  aid uuid;
  setup_oid oid;
BEGIN
  IF current_user<>'${PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER}' OR
     (SELECT oid FROM pg_roles WHERE rolname=current_user)<>10 OR
     (SELECT count(*) FROM core."privateNativeAction")<>1 THEN
    RAISE EXCEPTION 'Stock credential withdrawal unavailable' USING ERRCODE='55000';
  END IF;
  SELECT "actionId" INTO STRICT aid FROM core."privateNativeAction";
  SELECT oid INTO STRICT setup_oid FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_STOCK_ROLE}';
  IF shobj_description(setup_oid,'pg_authid') IS DISTINCT FROM 'private-native-stock-v1:'||aid::text THEN
    RAISE EXCEPTION 'Stock credential withdrawal unavailable' USING ERRCODE='55000';
  END IF;
  ALTER ROLE ${PRIVATE_NATIVE_STOCK_ROLE} NOLOGIN PASSWORD NULL;
  RETURN jsonb_build_object('actionId',aid,'disabled',true,'roleOid',setup_oid::text);
END
`;

export const PRIVATE_NATIVE_STOCK_WITHDRAW_BODY = `
DECLARE
  a core."privateNativeAction"%ROWTYPE;
  setup_oid oid;
  relation_name text;
  setup_user uuid;
  setup_membership uuid;
  member_exists boolean;
  numeric_uuid numeric := 0;
  digit integer;
  hex_uuid text;
  base36 text := '';
  schema_name text;
  i integer;
BEGIN
  IF current_user<>'${PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER}' OR
     (SELECT oid FROM pg_roles WHERE rolname=current_user)<>10 OR
     (SELECT count(*) FROM core."privateNativeAction")<>1 THEN
    RAISE EXCEPTION 'Stock withdrawal unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT a FROM core."privateNativeAction";
  hex_uuid:=replace(a."plannedWorkspaceId"::text,'-','');
  FOR i IN 1..32 LOOP
    digit:=strpos('0123456789abcdef',substr(hex_uuid,i,1))-1;
    IF digit<0 THEN RAISE EXCEPTION 'Stock setup unavailable' USING ERRCODE='55000'; END IF;
    numeric_uuid:=numeric_uuid*16+digit;
  END LOOP;
  WHILE numeric_uuid>0 LOOP
    digit:=mod(numeric_uuid,36)::integer;
    base36:=substr('0123456789abcdefghijklmnopqrstuvwxyz',digit+1,1)||base36;
    numeric_uuid:=pg_catalog.div(numeric_uuid,36);
  END LOOP;
  IF base36='' THEN base36:='0'; END IF;
  schema_name:='workspace_'||base36;
  SELECT oid INTO STRICT setup_oid FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_STOCK_ROLE}';
  IF shobj_description(setup_oid,'pg_authid') IS DISTINCT FROM
       'private-native-stock-v1:'||a."actionId"::text OR
     NOT EXISTS(SELECT 1 FROM pg_authid WHERE oid=setup_oid AND rolcanlogin=false AND rolpassword IS NULL) OR
     EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=setup_oid) OR
     EXISTS(SELECT 1 FROM pg_auth_members WHERE member=setup_oid OR roleid=setup_oid) OR
     EXISTS(SELECT 1 FROM pg_shdepend WHERE refclassid='pg_authid'::regclass
       AND refobjid=setup_oid AND dbid NOT IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))) THEN
    RAISE EXCEPTION 'Stock withdrawal unavailable' USING ERRCODE='55000';
  END IF;
  setup_user:=public.uuid_generate_v5(a."actionId",'private-native-stock-setup-user-v1');
  setup_membership:=public.uuid_generate_v5(a."actionId",'private-native-stock-setup-membership-v1');
  IF NOT EXISTS(SELECT 1 FROM core."user" WHERE id=setup_user AND disabled=true
       AND "deletedAt" IS NOT NULL AND "passwordHash" IS NULL AND "isEmailVerified"=false
       AND "canImpersonate"=false AND "canAccessFullAdminPanel"=false) OR
     EXISTS(SELECT 1 FROM core."userWorkspace" WHERE id=setup_membership OR "userId"=setup_user) OR
     EXISTS(SELECT 1 FROM core."roleTarget" WHERE "userWorkspaceId"=setup_membership) OR
     EXISTS(SELECT 1 FROM core."appToken" WHERE "userId"=setup_user) OR
     NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=schema_name AND nspowner=setup_oid) OR
     EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=setup_oid AND nspname<>schema_name) OR
     EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relowner=setup_oid AND n.nspname<>schema_name) OR
     EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE t.typowner=setup_oid AND n.nspname<>schema_name) OR
     EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE p.proowner=setup_oid AND (n.nspname<>schema_name OR p.prosecdef)) THEN
    RAISE EXCEPTION 'Stock withdrawal unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."workspaceMember" WHERE "userId"=$1)',schema_name)
    INTO member_exists USING setup_user;
  IF member_exists THEN RAISE EXCEPTION 'Stock withdrawal unavailable' USING ERRCODE='55000'; END IF;
  -- Withdrawal is terminal, never native readiness or authority publication.
  -- The parent additionally proves owned pool/process closure before invocation.
  ALTER ROLE ${PRIVATE_NATIVE_STOCK_ROLE} NOLOGIN PASSWORD NULL;
  REASSIGN OWNED BY ${PRIVATE_NATIVE_STOCK_ROLE} TO ${PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER};
  FOREACH relation_name IN ARRAY ARRAY[${PRIVATE_NATIVE_STOCK_RELATIONS.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE core.%I FROM ${PRIVATE_NATIVE_STOCK_ROLE}',relation_name);
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[${PRIVATE_NATIVE_STOCK_READ_RELATIONS.map((name) => `'${name}'`).join(',')}]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE core.%I FROM ${PRIVATE_NATIVE_STOCK_ROLE}',relation_name);
  END LOOP;
  REVOKE USAGE ON SCHEMA core FROM ${PRIVATE_NATIVE_STOCK_ROLE};
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM ${PRIVATE_NATIVE_STOCK_ROLE}',current_database());
  ALTER DEFAULT PRIVILEGES FOR ROLE ${PRIVATE_NATIVE_STOCK_ROLE} GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE ${PRIVATE_NATIVE_STOCK_ROLE} GRANT USAGE ON TYPES TO PUBLIC;
  DROP ROLE ${PRIVATE_NATIVE_STOCK_ROLE};
  RETURN jsonb_build_object('actionId',a."actionId",'withdrawn',true,'roleOid',setup_oid::text);
END
`;

export const PRIVATE_NATIVE_STOCK_ROLE_BODY_HASHES = Object.freeze({
  begin: createHash('sha256')
    .update(PRIVATE_NATIVE_STOCK_BEGIN_BODY)
    .digest('hex'),
  disable: createHash('sha256')
    .update(PRIVATE_NATIVE_STOCK_DISABLE_BODY)
    .digest('hex'),
  withdraw: createHash('sha256')
    .update(PRIVATE_NATIVE_STOCK_WITHDRAW_BODY)
    .digest('hex'),
});

// Independent fixed parent readset, never a table grant or readiness publisher.
// Called only through the current original-action parent fence, including after
// owned business pools close and the setup role has been completely withdrawn.
export const PRIVATE_NATIVE_STOCK_OBSERVE_BODY = `
DECLARE
  a core."privateNativeAction"%ROWTYPE;
  w core.workspace%ROWTYPE;
  standard_application uuid;
  subject_member uuid;
  setup_member_present boolean;
  setup_user uuid;
  setup_membership uuid;
  subject_role uuid;
  numeric_uuid numeric := 0;
  digit integer;
  hex_uuid text;
  base36 text := '';
  schema_name text;
  i integer;
BEGIN
  IF current_user<>'${PRIVATE_NATIVE_STOCK_BOOTSTRAP_OWNER}' OR
     (SELECT oid FROM pg_roles WHERE rolname=current_user)<>10 OR
     (SELECT count(*) FROM core."privateNativeAction")<>1 OR
     (SELECT count(*) FROM core.workspace)<>1 THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT a FROM core."privateNativeAction";
  hex_uuid:=replace(a."plannedWorkspaceId"::text,'-','');
  FOR i IN 1..32 LOOP
    digit:=strpos('0123456789abcdef',substr(hex_uuid,i,1))-1;
    IF digit<0 THEN RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000'; END IF;
    numeric_uuid:=numeric_uuid*16+digit;
  END LOOP;
  WHILE numeric_uuid>0 LOOP
    digit:=mod(numeric_uuid,36)::integer;
    base36:=substr('0123456789abcdefghijklmnopqrstuvwxyz',digit+1,1)||base36;
    numeric_uuid:=pg_catalog.div(numeric_uuid,36);
  END LOOP;
  IF base36='' THEN base36:='0'; END IF;
  schema_name:='workspace_'||base36;
  SELECT * INTO STRICT w FROM core.workspace WHERE id=a."plannedWorkspaceId";
  IF w."activationStatus"<>'ACTIVE' OR w."databaseSchema" IS DISTINCT FROM schema_name OR w."deletedAt" IS NOT NULL OR w."suspendedAt" IS NOT NULL OR
     w."workspaceCustomApplicationId" IS DISTINCT FROM a."plannedApplicationId" OR
     NOT EXISTS(SELECT 1 FROM core."privateNativeWorkspaceBinding" WHERE "actionId"=a."actionId" AND "workspaceId"=w.id AND "userId"=a."plannedUserId" AND "userWorkspaceId"=a."plannedUserWorkspaceId") OR
     (SELECT count(*) FROM core."dataSource")<>1 OR
     NOT EXISTS(SELECT 1 FROM core."dataSource" WHERE "workspaceId"=w.id AND "schema"=w."databaseSchema") OR
     EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_STOCK_ROLE}') THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT id INTO STRICT standard_application FROM core.application WHERE "workspaceId"=w.id AND "universalIdentifier"='20202020-64aa-4b6f-b003-9c74b97cee20';
  IF (SELECT count(*) FROM core.application WHERE "workspaceId"=w.id)<>2 OR
     NOT EXISTS(SELECT 1 FROM core.application WHERE id=a."plannedApplicationId" AND "workspaceId"=w.id AND "universalIdentifier"=a."plannedApplicationId") THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM core."user" WHERE id=a."plannedUserId" AND email='subject-'||a."ownerSubject"::text||'@native.invalid'
      AND disabled=false AND "deletedAt" IS NULL AND "isEmailVerified"=false AND "passwordHash" IS NULL AND "canImpersonate"=false AND "canAccessFullAdminPanel"=false) OR
     (SELECT count(*) FROM core."userWorkspace" WHERE "userId"=a."plannedUserId")<>1 OR
     NOT EXISTS(SELECT 1 FROM core."userWorkspace" WHERE id=a."plannedUserWorkspaceId" AND "workspaceId"=w.id AND "userId"=a."plannedUserId" AND "deletedAt" IS NULL) OR
     EXISTS(SELECT 1 FROM core.application p WHERE p."workspaceId"=w.id AND (p."packageJsonChecksum" IS DISTINCT FROM 'cbe15a5c1c73b15f40d168ee46ce845d' OR p."yarnLockChecksum" IS DISTINCT FROM 'fefb6d70e11253c793bf94197d615b45' OR NOT EXISTS(
       SELECT 1 FROM core.file f WHERE f.id=p."packageJsonFileId" AND f."workspaceId"=w.id AND f."applicationId"=p.id AND f.path='dependencies/package.json' AND f.size=1387 AND f."mimeType"='application/octet-stream' AND f."deletedAt" IS NULL
     ) OR NOT EXISTS(
       SELECT 1 FROM core.file f WHERE f.id=p."yarnLockFileId" AND f."workspaceId"=w.id AND f."applicationId"=p.id AND f.path='dependencies/yarn.lock' AND f.size=112283 AND f."mimeType"='application/octet-stream' AND f."deletedAt" IS NULL
     ) OR NOT EXISTS(
       SELECT 1 FROM core.file f WHERE f."workspaceId"=w.id AND f."applicationId"=p.id AND f.path='generated-sdk-client/twenty-client-sdk.zip' AND f.size>0 AND f.size<=16777216 AND f."mimeType"='application/zip' AND f."deletedAt" IS NULL
     ))) OR NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=schema_name AND nspowner=10) THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  setup_user:=public.uuid_generate_v5(a."actionId",'private-native-stock-setup-user-v1');
  setup_membership:=public.uuid_generate_v5(a."actionId",'private-native-stock-setup-membership-v1');
  IF EXISTS(SELECT 1 FROM core."userWorkspace" WHERE id=setup_membership OR "userId"=setup_user) OR
     EXISTS(SELECT 1 FROM core."roleTarget" WHERE "userWorkspaceId"=setup_membership) OR
     EXISTS(SELECT 1 FROM core."appToken" WHERE "userId"=setup_user) OR
     NOT EXISTS(SELECT 1 FROM core."user" WHERE id=setup_user AND disabled=true AND "deletedAt" IS NOT NULL AND "isEmailVerified"=false AND "passwordHash" IS NULL AND "canImpersonate"=false AND "canAccessFullAdminPanel"=false) THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM core."roleTarget" WHERE "userWorkspaceId"=a."plannedUserWorkspaceId")<>1 THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  SELECT r.id INTO STRICT subject_role FROM core."roleTarget" t JOIN core.role r ON r.id=t."roleId"
    WHERE t."userWorkspaceId"=a."plannedUserWorkspaceId" AND r."workspaceId"=w.id
      AND r."canUpdateAllSettings"=false AND r."canBeAssignedToUsers"=true
      AND r."canBeAssignedToAgents"=false AND r."canBeAssignedToApiKeys"=false
      AND r.label='Guest' AND r."applicationId"=a."plannedApplicationId" AND r."canAccessAllTools"=false AND r."canReadAllObjectRecords"=true
      AND r."canUpdateAllObjectRecords"=false AND r."canSoftDeleteAllObjectRecords"=false AND r."canDestroyAllObjectRecords"=false;
  IF EXISTS(SELECT 1 FROM core."objectPermission" WHERE "roleId"=subject_role) OR
     EXISTS(SELECT 1 FROM core."fieldPermission" WHERE "roleId"=subject_role) OR
     EXISTS(SELECT 1 FROM core."permissionFlag" WHERE "roleId"=subject_role) OR
     EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicate" WHERE "roleId"=subject_role) OR
     EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicateGroup" WHERE "roleId"=subject_role) THEN
    RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('SELECT id FROM %I."workspaceMember" WHERE "userId"=$1',w."databaseSchema") INTO STRICT subject_member USING a."plannedUserId";
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I."workspaceMember" WHERE "userId"=$1)',w."databaseSchema") INTO setup_member_present USING setup_user;
  IF setup_member_present THEN RAISE EXCEPTION 'Stock observation unavailable' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('actionId',a."actionId",'workspaceId',w.id,'schemaName',w."databaseSchema",'userId',a."plannedUserId",'userWorkspaceId',a."plannedUserWorkspaceId",'workspaceMemberId',subject_member,'roleId',subject_role,'customApplicationId',a."plannedApplicationId",'standardApplicationId',standard_application,'setupRemoved',true);
END
`;
