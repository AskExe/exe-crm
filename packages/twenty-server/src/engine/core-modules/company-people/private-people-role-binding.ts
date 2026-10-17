import { createHash } from 'node:crypto';
import { types } from 'node:util';

import { COMPANY_UUID } from 'src/engine/core-modules/company-auth/company-auth.config';

export type PrivatePeopleRoleBinding = Readonly<{
  companyId: string;
  workspaceId: string;
  metadataRole: string;
  writerRole: string;
  cacheRole: string;
  cachePrefix: string;
}>;

// The protected parent supplies the current Core pair. Names do not authorize
// a caller or qualify shared-cluster grants, RLS or verified onboarding.
export const derivePrivatePeopleRoleBinding = (
  companyId: string,
  workspaceId: string,
): PrivatePeopleRoleBinding => {
  if (
    typeof companyId !== 'string' ||
    typeof workspaceId !== 'string' ||
    !COMPANY_UUID.test(companyId) ||
    !COMPANY_UUID.test(workspaceId)
  ) {
    throw new Error('Private people role binding unavailable');
  }
  const token = createHash('sha256')
    .update(
      JSON.stringify(['crm-private-people-shared-v2', companyId, workspaceId]),
    )
    .digest('hex')
    .slice(0, 56);
  return Object.freeze({
    companyId,
    workspaceId,
    metadataRole: `crm_m_${token}`,
    writerRole: `crm_w_${token}`,
    cacheRole: `crm_c_${token}`,
    cachePrefix: `crm:company:${companyId}:workspace:${workspaceId}:`,
  });
};

// This validates only a protected v2 role-profile projection against the pair
// retained by the trusted parent. It does not admit IO or enable hosted mode.
export const readPrivatePeopleSharedRoleProfile = (
  value: unknown,
  companyId: string,
  workspaceId: string,
): PrivatePeopleRoleBinding => {
  if (
    typeof value !== 'object' ||
    value === null ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Private people role profile unavailable');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  const expected = derivePrivatePeopleRoleBinding(companyId, workspaceId);
  const keys = ['version', ...Object.keys(expected)];
  if (
    Reflect.ownKeys(fields).length !== keys.length ||
    keys.some((key) => !fields[key] || !('value' in fields[key])) ||
    fields.version.value !== 2 ||
    Object.entries(expected).some(([key, field]) => fields[key].value !== field)
  ) {
    throw new Error('Private people role profile unavailable');
  }
  return expected;
};

// Only compare an already-derived server binding. A role name alone, a browser
// header or a mutable session GUC cannot choose the company/workspace pair.
export const assertPrivatePeopleRoleBinding = (
  binding: PrivatePeopleRoleBinding,
  companyId: string,
  workspaceId: string,
) => {
  const expected = derivePrivatePeopleRoleBinding(companyId, workspaceId);
  if (
    binding.companyId !== expected.companyId ||
    binding.workspaceId !== expected.workspaceId ||
    binding.metadataRole !== expected.metadataRole ||
    binding.writerRole !== expected.writerRole ||
    binding.cacheRole !== expected.cacheRole ||
    binding.cachePrefix !== expected.cachePrefix
  ) {
    throw new Error('Private people role binding unavailable');
  }
};

// The private assembly's ten real providers are the complete admitted cache set.
// API-key role metadata is cached data; it never supplies actor authorization.
const PRIVATE_CACHE_KEYS = [
  'feature-flag:feature-flags-map',
  'flat-maps:row-level-permission-predicate-group',
  'flat-maps:row-level-permission-predicate',
  'flat-maps:field-metadata',
  'flat-maps:object-metadata',
  'metadata:permissions:user-workspace-role-map',
  'metadata:permissions:api-key-role-map',
  'flat-maps:index',
  'metadata:permissions:roles-permissions',
  'orm:entity-metadatas',
] as const;

export const privatePeopleExpectedConnectionRole = (
  binding: PrivatePeopleRoleBinding,
  kind: 'metadata' | 'writer' | 'cache',
): string => {
  assertPrivatePeopleRoleBinding(
    binding,
    binding.companyId,
    binding.workspaceId,
  );
  if (kind === 'metadata') return binding.metadataRole;
  if (kind === 'writer') return binding.writerRole;
  if (kind === 'cache') return binding.cacheRole;
  throw new Error('Private people connection role unavailable');
};

// Called centrally before both store operations and direct Redis mget/mdel.
// No wildcard, lock, other namespace, or another workspace can become an ACL key.
export const privatePeopleBoundRedisKey = (
  binding: PrivatePeopleRoleBinding,
  namespace: string,
  key: string,
): string => {
  assertPrivatePeopleRoleBinding(
    binding,
    binding.companyId,
    binding.workspaceId,
  );
  if (
    namespace !== 'engine:workspace' ||
    typeof key !== 'string' ||
    !PRIVATE_CACHE_KEYS.some((name) =>
      ['data', 'hash'].some(
        (part) => key === `${name}:${binding.workspaceId}:${part}`,
      ),
    )
  ) {
    throw new Error('Private people cache key unavailable');
  }
  return `${binding.cachePrefix}${namespace}:${key}`;
};

export type PrivatePeopleCurrentPair = Readonly<{
  companyId: string;
  workspaceId: string;
}>;

// The protected worker supplies this from the captured Core V2 projection.
// Read no protected connection and acquire no resource before this snapshot.
export const capturePrivatePeopleCurrentPair = (
  value: unknown,
): PrivatePeopleCurrentPair => {
  if (
    typeof value !== 'object' ||
    value === null ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error('Private people current pair unavailable');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== 2 ||
    !fields.companyId ||
    !('value' in fields.companyId) ||
    !fields.workspaceId ||
    !('value' in fields.workspaceId) ||
    typeof fields.companyId.value !== 'string' ||
    typeof fields.workspaceId.value !== 'string'
  )
    throw new Error('Private people current pair unavailable');
  const binding = derivePrivatePeopleRoleBinding(
    fields.companyId.value,
    fields.workspaceId.value,
  );
  return Object.freeze({
    companyId: binding.companyId,
    workspaceId: binding.workspaceId,
  });
};
