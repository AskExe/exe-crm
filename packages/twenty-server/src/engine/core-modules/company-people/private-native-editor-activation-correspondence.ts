import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { v5 } from 'uuid';

import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

import {
  OwnedCoreNativeAccessTransaction,
  type PrivateNativeAccessSnapshot,
  type PrivateNativeCorrespondenceRunner,
  verifyPrivateNativeActivationReceipt,
} from './private-native-activation-correspondence';
import { type PrivatePeopleDeadline } from './private-people-contract';

export type NativeEditorScopes =
  | readonly ['crm:read']
  | readonly ['crm:read', 'crm:write'];
export type NativeEditorRoleProjection = Readonly<{
  actionId: string;
  readerRoleId: string;
  writerRoleId: string;
  personObjectMetadataId: string;
  companyObjectMetadataId: string;
}>;
export type PrivateNativeEditorAccessSnapshot = Readonly<
  PrivateNativeAccessSnapshot & {
    version: 2;
    activationScopes: NativeEditorScopes;
    latestRequestId: string;
    recordRoles: NativeEditorRoleProjection;
  }
>;

// No public producer. The protected Core composition must retain its actual
// current locks, latest-request quarantine and immutable observed association.
export abstract class OwnedCoreNativeEditorAccessTransaction extends OwnedCoreNativeAccessTransaction {
  abstract override assertCurrent(
    end: PrivatePeopleDeadline,
  ): Promise<PrivateNativeEditorAccessSnapshot>;
}
const unavailable = () =>
  new Error('Private native editor correspondence unavailable');
const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function selectedRole(source: PrivateNativeEditorAccessSnapshot): string {
  const roles = source.recordRoles;
  if (
    source.version !== 2 ||
    source.latestRequestId !== source.requestId ||
    (!equal(source.activationScopes, ['crm:read']) &&
      !equal(source.activationScopes, ['crm:read', 'crm:write'])) ||
    !roles ||
    Object.keys(roles).sort().join(',') !==
      'actionId,companyObjectMetadataId,personObjectMetadataId,readerRoleId,writerRoleId' ||
    !Object.values(roles).every(
      (value) => typeof value === 'string' && UUID.test(value),
    ) ||
    roles.readerRoleId !==
      v5('private-native-stock-record-reader-role-v1', roles.actionId) ||
    roles.writerRoleId !==
      v5('private-native-stock-record-writer-role-v1', roles.actionId) ||
    new Set([
      roles.readerRoleId,
      roles.writerRoleId,
      roles.personObjectMetadataId,
      roles.companyObjectMetadataId,
    ]).size !== 4
  )
    throw unavailable();
  return source.activationScopes.length === 2
    ? roles.writerRoleId
    : roles.readerRoleId;
}

// V1 reader and its deliberately unavailable isolation producer stay unchanged.
// This V2 reader neither assigns a native role nor admits a browser principal.
export async function readPrivateNativeEditorActivationLedger(
  runner: PrivateNativeCorrespondenceRunner,
  authority: OwnedCoreNativeEditorAccessTransaction,
  end: PrivatePeopleDeadline,
) {
  authority.assertHeld(end);
  const before = await authority.assertCurrent(end);
  const roleId = selectedRole(before);
  authority.assertHeld(end);
  end.remaining();
  if (!runner.isTransactionActive || runner.isReleased) throw unavailable();
  const rows: unknown = await runner.query(
    `
    SELECT "requestId","companyId","subjectId","workspaceId","clientId","bindingId","generationId",
      "authzEpoch",audience,"policyRevision","payloadSha256","identitySha256","parentSessionId","parentExp",
      attempt,"coordinatorId","profileSha256","databaseAssociationSha256","userId","userWorkspaceId",
      "workspaceMemberId","roleId","ackUtf8","ackSha256","receiptInputUtf8","receiptSha256",
      "activationVersion","activationScopes"
    FROM core."privateNativeIdentityActivation" WHERE "requestId"=$1`,
    [before.requestId],
  );
  authority.assertHeld(end);
  end.remaining();
  if (!Array.isArray(rows) || rows.length !== 1) throw unavailable();
  const row = rows[0] as Record<string, unknown>;
  if (
    !row ||
    types.isProxy(row) ||
    Object.getPrototypeOf(row) !== Object.prototype ||
    Reflect.ownKeys(row).some(
      (key) =>
        typeof key !== 'string' ||
        !Object.getOwnPropertyDescriptor(row, key) ||
        !('value' in Object.getOwnPropertyDescriptor(row, key)!),
    )
  )
    throw unavailable();
  const pairs = {
    requestId: before.requestId,
    companyId: before.companyId,
    subjectId: before.subjectId,
    workspaceId: before.workspaceId,
    clientId: before.clientId,
    bindingId: before.bindingId,
    generationId: before.generationId,
    authzEpoch: before.authzEpoch,
    audience: before.audience,
    policyRevision: before.activationPolicyRevision,
    payloadSha256: before.payloadSha256,
    identitySha256: before.identitySha256,
    parentSessionId: before.activationParentSessionId,
    parentExp: before.activationParentExp,
    attempt: before.attempt,
    coordinatorId: before.coordinatorId,
    profileSha256: before.profileSha256,
    databaseAssociationSha256: before.databaseAssociationSha256,
    receiptSha256: before.receiptSha256,
    activationVersion: 2,
    activationScopes: before.activationScopes,
  };
  const expectedKeys = [
    ...Object.keys(pairs),
    'userId',
    'userWorkspaceId',
    'workspaceMemberId',
    'roleId',
    'ackUtf8',
    'ackSha256',
    'receiptInputUtf8',
  ];
  if (Object.keys(row).sort().join(',') !== expectedKeys.sort().join(','))
    throw unavailable();
  for (const [key, expected] of Object.entries(pairs))
    if (!equal(row[key], expected)) throw unavailable();
  if (
    !(row.ackUtf8 instanceof Uint8Array) ||
    !(row.receiptInputUtf8 instanceof Uint8Array)
  )
    throw unavailable();
  const verified = verifyPrivateNativeActivationReceipt(
    row.ackUtf8,
    row.receiptInputUtf8,
    before,
  );
  if (
    row.ackSha256 !== verified.ackSha256 ||
    row.roleId !== roleId ||
    row.userId !== verified.ack.user_id ||
    row.userWorkspaceId !== verified.ack.user_workspace_id ||
    row.workspaceMemberId !== verified.ack.workspace_member_id ||
    row.roleId !== verified.ack.role_id
  )
    throw unavailable();
  const after = await authority.assertCurrent(end);
  authority.assertHeld(end);
  end.remaining();
  if (!equal(before, after) || selectedRole(after) !== roleId)
    throw unavailable();
  return verified;
}

// Caller holds a native transaction: the fixed final adapter obtains the table
// and exact-row locks before this read, preventing phantom additional targets.
export async function verifyPrivateNativeEditorCurrentRole(
  runner: PrivateNativeCorrespondenceRunner,
  authority: OwnedCoreNativeEditorAccessTransaction,
  end: PrivatePeopleDeadline,
) {
  const verified = await readPrivateNativeEditorActivationLedger(
    runner,
    authority,
    end,
  );
  authority.assertHeld(end);
  const before = await authority.assertCurrent(end);
  const roleId = selectedRole(before),
    schema = getWorkspaceSchemaName(before.workspaceId);
  end.remaining();
  const rows: unknown = await runner.query(
    `
    SELECT w.id AS "workspaceId",u.id AS "userId",uw.id AS "userWorkspaceId",m.id AS "workspaceMemberId",t."roleId"
    FROM core.workspace w JOIN core."userWorkspace" uw ON uw."workspaceId"=w.id
    JOIN core."user" u ON u.id=uw."userId"
    JOIN core."roleTarget" t ON t."workspaceId"=w.id AND t."userWorkspaceId"=uw.id
    JOIN core.role r ON r.id=t."roleId" AND r."workspaceId"=w.id
    JOIN "${schema}"."workspaceMember" m ON m."userId"=u.id
    WHERE w.id=$1 AND u.id=$2 AND uw.id=$3 AND m.id=$4 AND r.id=$5
      AND w."activationStatus"='ACTIVE' AND w."databaseSchema"=$6 AND w."deletedAt" IS NULL AND w."suspendedAt" IS NULL
      AND u."deletedAt" IS NULL AND u.disabled=false AND u."isEmailVerified"=true AND u.email=$7
      AND u."canImpersonate"=false AND u."canAccessFullAdminPanel"=false AND u."passwordHash" IS NULL
      AND uw."deletedAt" IS NULL AND m."deletedAt" IS NULL
      AND (SELECT count(*) FROM core."roleTarget" WHERE "userWorkspaceId"=uw.id)=1
      AND r."canBeAssignedToUsers"=true AND r."canBeAssignedToAgents"=false AND r."canBeAssignedToApiKeys"=false
      AND r."canReadAllObjectRecords"=false AND r."canUpdateAllObjectRecords"=false
      AND r."canSoftDeleteAllObjectRecords"=false AND r."canDestroyAllObjectRecords"=false
      AND r."canUpdateAllSettings"=false AND r."canAccessAllTools"=false AND r."isEditable"=false
      AND r.label=CASE WHEN $8 THEN 'Company record writer' ELSE 'Company record reader' END
      AND r."universalIdentifier"=$9
      AND EXISTS(SELECT 1 FROM core."privateNativeAction" a
        WHERE a."actionId"=$10 AND a."plannedWorkspaceId"=w.id AND a."plannedUserId"=u.id
          AND a."plannedUserWorkspaceId"=uw.id AND a."ownerSubject"=$11
          AND r."applicationId"=a."plannedApplicationId")
      AND (SELECT count(*) FROM core."objectPermission" WHERE "roleId"=r.id)=2
      AND (SELECT count(DISTINCT "objectMetadataId") FROM core."objectPermission" WHERE "roleId"=r.id)=2
      AND (SELECT count(*) FROM core."objectPermission" p JOIN core."objectMetadata" o ON o.id=p."objectMetadataId"
        JOIN core.application app ON app.id=o."applicationId"
        WHERE p."roleId"=r.id AND p."workspaceId"=w.id AND p."applicationId"=r."applicationId"
          AND p."canReadObjectRecords"=true AND p."canUpdateObjectRecords"=$8
          AND p."canSoftDeleteObjectRecords"=false AND p."canDestroyObjectRecords"=false
          AND o."workspaceId"=w.id AND o."isSystem"=false AND app."workspaceId"=w.id
          AND app."universalIdentifier"='20202020-64aa-4b6f-b003-9c74b97cee20'
          AND ((o.id=$12 AND o."nameSingular"='person' AND o."universalIdentifier"='20202020-e674-48e5-a542-72570eee7213')
            OR (o.id=$13 AND o."nameSingular"='company' AND o."universalIdentifier"='20202020-b374-4779-a561-80086cb2e17f')))=2
      AND NOT EXISTS(SELECT 1 FROM core."fieldPermission" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."permissionFlag" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicate" WHERE "roleId"=r.id)
      AND NOT EXISTS(SELECT 1 FROM core."rowLevelPermissionPredicateGroup" WHERE "roleId"=r.id)`,
    [
      before.workspaceId,
      verified.ack.user_id,
      verified.ack.user_workspace_id,
      verified.ack.workspace_member_id,
      roleId,
      schema,
      before.verifiedEmail,
      before.activationScopes.length === 2,
      v5(
        before.activationScopes.length === 2
          ? 'private-native-stock-record-writer-role-universal-v1'
          : 'private-native-stock-record-reader-role-universal-v1',
        before.recordRoles.actionId,
      ),
      before.recordRoles.actionId,
      before.subjectId,
      before.recordRoles.personObjectMetadataId,
      before.recordRoles.companyObjectMetadataId,
    ],
  );
  authority.assertHeld(end);
  end.remaining();
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !equal(rows[0], {
      workspaceId: before.workspaceId,
      userId: verified.ack.user_id,
      userWorkspaceId: verified.ack.user_workspace_id,
      workspaceMemberId: verified.ack.workspace_member_id,
      roleId,
    })
  )
    throw unavailable();
  const after = await authority.assertCurrent(end);
  authority.assertHeld(end);
  end.remaining();
  if (!equal(before, after) || selectedRole(after) !== roleId)
    throw unavailable();
  return Object.freeze({
    roleId,
    ack: verified.ack,
    receiptSha256: before.receiptSha256,
    scopes: Object.freeze([...before.activationScopes]),
    correspondenceSha256: createHash('sha256')
      .update(
        JSON.stringify([
          before.requestId,
          before.payloadSha256,
          roleId,
          before.activationScopes,
        ]),
      )
      .digest('hex'),
  });
}
