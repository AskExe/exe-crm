import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { type QueryRunner } from 'typeorm';

import { type CompanyAuthConfiguration } from '../company-auth/company-auth.config';

import { type PrivatePeopleDeadline } from './private-people-contract';

export type PrivateNativeCorrespondenceRunner = Pick<
  QueryRunner,
  'isTransactionActive' | 'isReleased'
> & {
  query: (query: string, parameters?: unknown[]) => Promise<unknown>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ACK_FIELDS = [
  'request_id',
  'company_id',
  'subject_id',
  'workspace_id',
  'identity_sha256',
  'parent_session_id',
  'parent_exp',
  'user_id',
  'user_workspace_id',
  'workspace_member_id',
  'role_id',
  'commit',
] as const;

export type PrivateNativeActivationAck = Readonly<{
  request_id: string;
  company_id: string;
  subject_id: string;
  workspace_id: string;
  identity_sha256: string;
  parent_session_id: string;
  parent_exp: string;
  user_id: string;
  user_workspace_id: string;
  workspace_member_id: string;
  role_id: string;
  commit: 'acknowledged';
}>;

export type PrivateNativeAccessSnapshot = Readonly<{
  requestId: string;
  companyId: string;
  subjectId: string;
  workspaceId: string;
  clientId: string;
  bindingId: string;
  generationId: string;
  authzEpoch: string;
  audience: string;
  activationPolicyRevision: string;
  currentAccessPolicyRevision: string;
  payloadSha256: string;
  identitySha256: string;
  verifiedEmail: string;
  activationParentSessionId: string;
  activationParentExp: string;
  currentParentSessionId: string;
  currentParentExp: string;
  attempt: 1;
  coordinatorId: string;
  receiptSha256: string;
  profileSha256: string;
  databaseAssociationSha256: string;
}>;

// No producer exists yet. Only protected Core composition may implement this
// retained transaction; a passive settlement JSON is not an admission handle.
export abstract class OwnedCoreNativeAccessTransaction {
  abstract assertCurrent(
    end: PrivatePeopleDeadline,
  ): Promise<PrivateNativeAccessSnapshot>;
  abstract assertHeld(end: PrivatePeopleDeadline): void;
}

const data = (value: unknown, fields: readonly string[]) => {
  if (typeof value !== 'object' || value === null || types.isProxy(value))
    throw new Error('Private native correspondence unavailable');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error('Private native correspondence unavailable');
  const names = Reflect.ownKeys(value);
  if (
    names.length !== fields.length ||
    names.some((name) => typeof name !== 'string' || !fields.includes(name))
  )
    throw new Error('Private native correspondence unavailable');
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !('value' in descriptor))
      throw new Error('Private native correspondence unavailable');
    result[field] = descriptor.value;
  }
  return result;
};

const text = (value: unknown, maximum: number) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum)
    throw new Error('Private native correspondence unavailable');
  return value;
};
const uuid = (value: unknown) => {
  const result = text(value, 36);
  if (!UUID.test(result))
    throw new Error('Private native correspondence unavailable');
  return result;
};
const hash = (value: unknown) => {
  const result = text(value, 64);
  if (!HASH.test(result))
    throw new Error('Private native correspondence unavailable');
  return result;
};
const expiry = (value: unknown) => {
  const result = text(value, 20);
  if (!/^[1-9][0-9]{0,19}$/.test(result))
    throw new Error('Private native correspondence unavailable');
  return result;
};
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export const readPrivateNativeActivationAck = (
  bytes: Uint8Array,
): PrivateNativeActivationAck => {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > 4096
  )
    throw new Error('Private native correspondence unavailable');
  const original = Buffer.from(bytes);
  const decoded: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(original),
  );
  const row = data(decoded, ACK_FIELDS);
  if (row.commit !== 'acknowledged')
    throw new Error('Private native correspondence unavailable');
  const ack: PrivateNativeActivationAck = {
    request_id: uuid(row.request_id),
    company_id: uuid(row.company_id),
    subject_id: uuid(row.subject_id),
    workspace_id: uuid(row.workspace_id),
    identity_sha256: hash(row.identity_sha256),
    parent_session_id: uuid(row.parent_session_id),
    parent_exp: expiry(row.parent_exp),
    user_id: uuid(row.user_id),
    user_workspace_id: uuid(row.user_workspace_id),
    workspace_member_id: uuid(row.workspace_member_id),
    role_id: uuid(row.role_id),
    commit: 'acknowledged',
  };
  // Validate original ordering without replacing it by the normalized object.
  if (!Buffer.from(JSON.stringify(decoded), 'utf8').equals(original))
    throw new Error('Private native correspondence unavailable');
  return Object.freeze(ack);
};

export const verifyPrivateNativeActivationReceipt = (
  originalAck: Uint8Array,
  originalReceipt: Uint8Array,
  source: PrivateNativeAccessSnapshot,
) => {
  if (
    !(originalReceipt instanceof Uint8Array) ||
    originalReceipt.byteLength > 8192
  )
    throw new Error('Private native correspondence unavailable');
  const ack = readPrivateNativeActivationAck(originalAck);
  if (
    ack.request_id !== source.requestId ||
    ack.company_id !== source.companyId ||
    ack.subject_id !== source.subjectId ||
    ack.workspace_id !== source.workspaceId ||
    ack.identity_sha256 !== source.identitySha256 ||
    ack.parent_session_id !== source.activationParentSessionId ||
    ack.parent_exp !== source.activationParentExp
  )
    throw new Error('Private native correspondence unavailable');
  hash(source.payloadSha256);
  hash(source.receiptSha256);
  const original: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(originalAck),
  );
  const expected = Buffer.from(
    JSON.stringify([ack.request_id, source.payloadSha256, original]),
    'utf8',
  );
  if (
    !expected.equals(Buffer.from(originalReceipt)) ||
    digest(expected) !== source.receiptSha256
  )
    throw new Error('Private native correspondence unavailable');
  return Object.freeze({ ack, ackSha256: digest(originalAck) });
};

// Unregistered fixed reader; the existing private V2 factory still refuses
// before IO. Actual least-privilege column/RLS and Core producer are missing.
export const readPrivateNativeActivationLedger = async (
  runner: PrivateNativeCorrespondenceRunner,
  authority: OwnedCoreNativeAccessTransaction,
  end: PrivatePeopleDeadline,
) => {
  authority.assertHeld(end);
  const before = await authority.assertCurrent(end);
  text(before.currentAccessPolicyRevision, 128);
  authority.assertHeld(end);
  end.remaining();
  if (!runner.isTransactionActive || runner.isReleased)
    throw new Error('Private native correspondence unavailable');
  const rows: unknown = await runner.query(
    `SELECT "requestId", "companyId", "subjectId", "workspaceId", "clientId", "bindingId", "generationId",
      "authzEpoch", audience, "policyRevision", "payloadSha256", "identitySha256",
      "parentSessionId", "parentExp", attempt, "coordinatorId", "profileSha256",
      "databaseAssociationSha256", "userId", "userWorkspaceId", "workspaceMemberId", "roleId",
      "ackUtf8", "ackSha256", "receiptInputUtf8", "receiptSha256"
    FROM core."privateNativeIdentityActivation" WHERE "requestId"=$1`,
    [uuid(before.requestId)],
  );
  authority.assertHeld(end);
  end.remaining();
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error('Private native correspondence unavailable');
  const fields = [
    'requestId',
    'companyId',
    'subjectId',
    'workspaceId',
    'clientId',
    'bindingId',
    'generationId',
    'authzEpoch',
    'audience',
    'policyRevision',
    'payloadSha256',
    'identitySha256',
    'parentSessionId',
    'parentExp',
    'attempt',
    'coordinatorId',
    'profileSha256',
    'databaseAssociationSha256',
    'userId',
    'userWorkspaceId',
    'workspaceMemberId',
    'roleId',
    'ackUtf8',
    'ackSha256',
    'receiptInputUtf8',
    'receiptSha256',
  ];
  const row = data(rows[0], fields);
  const pairs: readonly (readonly [
    string,
    keyof PrivateNativeAccessSnapshot,
  ])[] = [
    ['requestId', 'requestId'],
    ['companyId', 'companyId'],
    ['subjectId', 'subjectId'],
    ['workspaceId', 'workspaceId'],
    ['clientId', 'clientId'],
    ['bindingId', 'bindingId'],
    ['generationId', 'generationId'],
    ['authzEpoch', 'authzEpoch'],
    ['audience', 'audience'],
    ['policyRevision', 'activationPolicyRevision'],
    ['payloadSha256', 'payloadSha256'],
    ['identitySha256', 'identitySha256'],
    ['parentSessionId', 'activationParentSessionId'],
    ['parentExp', 'activationParentExp'],
    ['attempt', 'attempt'],
    ['coordinatorId', 'coordinatorId'],
    ['profileSha256', 'profileSha256'],
    ['databaseAssociationSha256', 'databaseAssociationSha256'],
    ['receiptSha256', 'receiptSha256'],
  ];
  for (const [column, key] of pairs)
    if (row[column] !== before[key])
      throw new Error('Private native correspondence unavailable');
  if (
    !(row.ackUtf8 instanceof Uint8Array) ||
    !(row.receiptInputUtf8 instanceof Uint8Array)
  )
    throw new Error('Private native correspondence unavailable');
  const verified = verifyPrivateNativeActivationReceipt(
    row.ackUtf8,
    row.receiptInputUtf8,
    before,
  );
  if (
    row.ackSha256 !== verified.ackSha256 ||
    row.userId !== verified.ack.user_id ||
    row.userWorkspaceId !== verified.ack.user_workspace_id ||
    row.workspaceMemberId !== verified.ack.workspace_member_id ||
    row.roleId !== verified.ack.role_id
  )
    throw new Error('Private native correspondence unavailable');
  const after = await authority.assertCurrent(end);
  authority.assertHeld(end);
  end.remaining();
  for (const key of Object.keys(
    before,
  ) as (keyof PrivateNativeAccessSnapshot)[])
    if (before[key] !== after[key])
      throw new Error('Private native correspondence unavailable');
  // This is only ledger correspondence, never a usable identity/cache profile.
  // Actual user/member/role joins must pass before any admission is returned.
  return verified;
};

// Core locks do not stop native administrator changes. The fixed native
// row-lock/current-isolation producer is absent, so initial native identity IO
// remains hard-refused. No UPDATE grant or unchecked definer is substituted.
const requirePrivateNativeIdentityIsolation = (): never => {
  throw new Error('Private native identity isolation unavailable');
};

// Same native transaction and the same still-held Core authority. This checks
// existing identity rows only; it does not activate a user or grant permissions.
export const verifyPrivateNativeActivationIdentity = async (
  runner: PrivateNativeCorrespondenceRunner,
  authority: OwnedCoreNativeAccessTransaction,
  configuration: CompanyAuthConfiguration,
  ack: PrivateNativeActivationAck,
  end: PrivatePeopleDeadline,
) => {
  requirePrivateNativeIdentityIsolation();
  const nativeSchema = configuration.nativeSchema;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(nativeSchema))
    throw new Error('Private native correspondence unavailable');
  authority.assertHeld(end);
  const current = await authority.assertCurrent(end);
  text(current.currentAccessPolicyRevision, 128);
  authority.assertHeld(end);
  end.remaining();
  const binding = configuration.bindings.get(current.subjectId);
  if (
    !binding ||
    current.companyId !== configuration.companyId ||
    current.workspaceId !== configuration.workspaceId ||
    current.clientId !== configuration.clientId ||
    current.bindingId !== configuration.bindingId ||
    current.generationId !== configuration.generationId ||
    current.audience !== configuration.audience ||
    binding.user_id !== ack.user_id ||
    binding.user_workspace_id !== ack.user_workspace_id ||
    binding.workspace_member_id !== ack.workspace_member_id
  )
    throw new Error('Private native correspondence unavailable');
  if (
    !runner.isTransactionActive ||
    runner.isReleased ||
    current.workspaceId !== ack.workspace_id ||
    current.subjectId !== ack.subject_id ||
    current.companyId !== ack.company_id ||
    current.requestId !== ack.request_id ||
    current.identitySha256 !== ack.identity_sha256
  )
    throw new Error('Private native correspondence unavailable');
  const rows: unknown = await runner.query(
    `SELECT w.id AS "workspaceId", u.id AS "userId", uw.id AS "userWorkspaceId",
      m.id AS "workspaceMemberId", r.id AS "roleId"
     FROM core.workspace w
     JOIN core."userWorkspace" uw ON uw."workspaceId"=w.id
     JOIN core."user" u ON u.id=uw."userId"
     JOIN core."roleTarget" t ON t."workspaceId"=w.id AND t."userWorkspaceId"=uw.id
     JOIN core.role r ON r.id=t."roleId" AND r."workspaceId"=w.id
     JOIN "${nativeSchema}"."workspaceMember" m ON m."userId"=u.id
     WHERE w.id=$1 AND u.id=$2 AND uw.id=$3 AND m.id=$4 AND r.id=$5
       AND w."activationStatus"='ACTIVE' AND w."databaseSchema"=$6
       AND w."deletedAt" IS NULL AND w."suspendedAt" IS NULL
       AND u."deletedAt" IS NULL AND u.disabled IS FALSE AND u."isEmailVerified" IS TRUE
       AND u.email=$7 AND u."canImpersonate" IS FALSE AND u."canAccessFullAdminPanel" IS FALSE
       AND uw."deletedAt" IS NULL AND m."deletedAt" IS NULL
       AND r."canUpdateAllSettings" IS FALSE AND r."canAccessAllTools" IS FALSE
       AND r."canReadAllObjectRecords" IS FALSE AND r."canUpdateAllObjectRecords" IS FALSE
       AND r."canDestroyAllObjectRecords" IS FALSE AND r."canSoftDeleteAllObjectRecords" IS FALSE`,
    [
      ack.workspace_id,
      ack.user_id,
      ack.user_workspace_id,
      ack.workspace_member_id,
      ack.role_id,
      nativeSchema,
      text(current.verifiedEmail, 320),
    ],
  );
  authority.assertHeld(end);
  end.remaining();
  if (!Array.isArray(rows) || rows.length !== 1)
    throw new Error('Private native correspondence unavailable');
  const row = data(rows[0], [
    'workspaceId',
    'userId',
    'userWorkspaceId',
    'workspaceMemberId',
    'roleId',
  ]);
  if (
    row.workspaceId !== ack.workspace_id ||
    row.userId !== ack.user_id ||
    row.userWorkspaceId !== ack.user_workspace_id ||
    row.workspaceMemberId !== ack.workspace_member_id ||
    row.roleId !== ack.role_id
  )
    throw new Error('Private native correspondence unavailable');
  const after = await authority.assertCurrent(end);
  authority.assertHeld(end);
  end.remaining();
  for (const key of Object.keys(
    current,
  ) as (keyof PrivateNativeAccessSnapshot)[])
    if (current[key] !== after[key])
      throw new Error('Private native correspondence unavailable');
  // Never returns an access capability. Existing people objectPermission gate,
  // catalog/RLS/Redis proofs and protected profile composition remain required.
};
