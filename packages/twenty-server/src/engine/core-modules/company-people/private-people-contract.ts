import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { COMPANY_UUID } from 'src/engine/core-modules/company-auth/company-auth.config';

export type PrivatePeopleSource = Readonly<{
  version: 2;
  purpose: 'business-action';
  subject_id: string;
  company_id: string;
  product: 'crm';
  resource_kind: 'crm-workspace';
  client_id: string;
  binding_id: string;
  native_id: string;
  generation_id: string;
  authz_epoch: string;
  audience: string;
  current_role: 'owner' | 'member';
  action: 'crm:people:create' | 'crm:people:import';
  policy_revision: string;
  commerce: unknown;
  request_id: string;
  payload_sha256: string;
  expires_at: string;
}>;

export type PrivatePeopleDeadline = {
  readonly signal: AbortSignal;
  remaining(): number;
};

export type PrivatePersonInput = Readonly<{ name: string; email: string }>;

const own = (
  value: unknown,
  keys: string[],
): value is Record<string, unknown> => {
  if (
    !value ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(descriptors).sort().join() === keys.sort().join() &&
    keys.every(
      (key) => descriptors[key].enumerable && 'value' in descriptors[key],
    )
  );
};

export const capturePrivatePeople = (
  source: PrivatePeopleSource,
  bytes: Uint8Array,
): { source: PrivatePeopleSource; rows: readonly PrivatePersonInput[] } => {
  const keys = [
    'version',
    'purpose',
    'subject_id',
    'company_id',
    'product',
    'resource_kind',
    'client_id',
    'binding_id',
    'native_id',
    'generation_id',
    'authz_epoch',
    'audience',
    'current_role',
    'action',
    'policy_revision',
    'commerce',
    'request_id',
    'payload_sha256',
    'expires_at',
  ];
  if (
    !own(source, keys) ||
    source.version !== 2 ||
    source.purpose !== 'business-action' ||
    source.product !== 'crm' ||
    source.resource_kind !== 'crm-workspace' ||
    !['owner', 'member'].includes(source.current_role) ||
    !['crm:people:create', 'crm:people:import'].includes(source.action)
  )
    throw new Error('Private people source unavailable');
  for (const key of [
    'subject_id',
    'company_id',
    'binding_id',
    'native_id',
    'generation_id',
    'request_id',
  ] as const)
    if (typeof source[key] !== 'string' || !COMPANY_UUID.test(source[key]))
      throw new Error('Private people source unavailable');
  for (const key of ['authz_epoch', 'policy_revision'] as const)
    if (
      typeof source[key] !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(source[key])
    )
      throw new Error('Private people source unavailable');
  for (const key of ['client_id', 'audience'] as const)
    if (
      typeof source[key] !== 'string' ||
      !/^[a-z][a-z0-9_-]{2,63}$/.test(source[key])
    )
      throw new Error('Private people source unavailable');
  if (
    typeof source.expires_at !== 'string' ||
    source.expires_at.length > 40 ||
    !Number.isFinite(Date.parse(source.expires_at)) ||
    types.isProxy(bytes) ||
    ![Uint8Array.prototype, Buffer.prototype].includes(
      Object.getPrototypeOf(bytes),
    ) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > 262144 ||
    typeof source.payload_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.payload_sha256) ||
    createHash('sha256').update(bytes).digest('hex') !== source.payload_sha256
  )
    throw new Error('Private people payload unavailable');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!Buffer.from(text).equals(Buffer.from(bytes)))
    throw new Error('Private people canonical bytes unavailable');
  const value: unknown = JSON.parse(text);
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 1000 ||
    (source.action === 'crm:people:create' && value.length !== 1) ||
    JSON.stringify(value) !== text
  )
    throw new Error('Private people payload unavailable');
  const rows = value.map((row: unknown) => {
    if (
      !own(row, ['name', 'email']) ||
      typeof row.name !== 'string' ||
      row.name.length < 1 ||
      row.name.length > 200 ||
      /[\x00-\x1f\x7f]/.test(row.name) ||
      typeof row.email !== 'string' ||
      row.email.length > 320 ||
      !/^\S+@\S+\.\S+$/.test(row.email)
    )
      throw new Error('Private people payload unavailable');
    return Object.freeze({ name: row.name, email: row.email });
  });
  // Commerce is deliberately not consumed as native permission authority.
  return {
    source: Object.freeze({ ...source, commerce: undefined }),
    rows: Object.freeze(rows),
  };
};
