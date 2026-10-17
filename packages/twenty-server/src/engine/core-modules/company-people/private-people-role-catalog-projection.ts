import { types } from 'node:util';

import { derivePrivatePeopleRoleBinding } from './private-people-role-binding';

// Fixed read-only query proposal for an operator-owned current database reader.
// Never executed here. Existing column/function/ownership guards remain required;
// this role projection is not table/RLS/actor authority or an IO capability.
export const PRIVATE_PEOPLE_ROLE_CATALOG_QUERY = `SELECT
  r.oid AS "roleOid", r.rolname AS "roleName",
  r.rolcanlogin AS "canLogin", r.rolinherit AS "inherits",
  r.rolsuper AS "superuser", r.rolcreatedb AS "createsDatabase",
  r.rolcreaterole AS "createsRole", r.rolreplication AS "replicates",
  r.rolbypassrls AS "bypassesRls",
  d.oid AS "databaseOid", d.datname AS "databaseName",
  d.datdba=r.oid AS "ownsDatabase",
  has_database_privilege(r.oid,d.oid,'CREATE,TEMP') AS "canCreateOrTemp",
  EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS "hasMemberships"
  FROM pg_roles r JOIN pg_database d ON d.datname=current_database()
  WHERE r.rolname=$1`;

export const privatePeopleCatalogRoleName = (
  companyId: string,
  workspaceId: string,
  kind: 'metadata' | 'writer',
): string => {
  const binding = derivePrivatePeopleRoleBinding(companyId, workspaceId);
  if (kind === 'metadata') return binding.metadataRole;
  if (kind === 'writer') return binding.writerRole;
  throw new Error('Private role catalog projection unavailable');
};

// Inputs must come only from a protected fixed reader, its retained current Core
// pair, and protected database association. No browser values or GUC authority.
// This remains unregistered; fabricated controlled rows are not native evidence.
export const assertPrivatePeopleCatalogRoleProjection = (
  value: unknown,
  companyId: string,
  workspaceId: string,
  kind: 'metadata' | 'writer',
  protectedDatabase: string,
): void => {
  const expectedRole = privatePeopleCatalogRoleName(
    companyId,
    workspaceId,
    kind,
  );
  if (
    typeof protectedDatabase !== 'string' ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(protectedDatabase) ||
    value === null ||
    typeof value !== 'object' ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Private role catalog projection unavailable');
  }
  const keys = [
    'roleOid',
    'roleName',
    'canLogin',
    'inherits',
    'superuser',
    'createsDatabase',
    'createsRole',
    'replicates',
    'bypassesRls',
    'databaseOid',
    'databaseName',
    'ownsDatabase',
    'canCreateOrTemp',
    'hasMemberships',
  ];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))
  ) {
    throw new Error('Private role catalog projection unavailable');
  }
  const fields: Record<string, unknown> = {};
  for (const key of keys) fields[key] = descriptors[key].value;
  if (
    typeof fields.roleOid !== 'number' ||
    !Number.isSafeInteger(fields.roleOid) ||
    fields.roleOid < 1 ||
    fields.roleOid > 4294967295 ||
    typeof fields.databaseOid !== 'number' ||
    !Number.isSafeInteger(fields.databaseOid) ||
    fields.databaseOid < 1 ||
    fields.databaseOid > 4294967295 ||
    fields.roleName !== expectedRole ||
    fields.databaseName !== protectedDatabase ||
    fields.canLogin !== true ||
    [
      'inherits',
      'superuser',
      'createsDatabase',
      'createsRole',
      'replicates',
      'bypassesRls',
      'ownsDatabase',
      'canCreateOrTemp',
      'hasMemberships',
    ].some((key) => fields[key] !== false)
  ) {
    throw new Error('Private role catalog projection unavailable');
  }
};
