import { types } from 'node:util';

import { derivePrivatePeopleRoleBinding } from './private-people-role-binding';

// Unregistered Source predicate for a protected operator reader's ACL GETUSER
// projection. It does not authenticate a client, grant ACLs, or admit native IO.
// A caller-provided/fabricated projection must never become runtime authority.
const PRIVATE_REDIS_COMMANDS = ['auth', 'quit', 'get', 'set', 'del', 'mget'];

const plainFields = (value: unknown, keys: string[]) => {
  if (
    value === null ||
    typeof value !== 'object' ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error('Private Redis ACL projection unavailable');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => !descriptors[key] || !('value' in descriptors[key]))
  ) {
    throw new Error('Private Redis ACL projection unavailable');
  }
  const fields: Record<string, unknown> = {};
  for (const key of keys) fields[key] = descriptors[key].value;
  return fields;
};

export const assertPrivatePeopleRedisAclProjection = (
  value: unknown,
  companyId: string,
  workspaceId: string,
): void => {
  const binding = derivePrivatePeopleRoleBinding(companyId, workspaceId);
  const fields = plainFields(value, [
    'username',
    'flags',
    'commands',
    'keys',
    'channels',
    'selectors',
    'passwordCount',
  ]);
  if (
    fields.username !== binding.cacheRole ||
    fields.flags !== 'on' ||
    fields.keys !== `~${binding.cachePrefix}*` ||
    fields.channels !== '' ||
    fields.selectors !== 0 ||
    fields.passwordCount !== 1 ||
    typeof fields.commands !== 'string'
  ) {
    throw new Error('Private Redis ACL projection unavailable');
  }
  const commands = fields.commands.split(' ');
  if (
    commands[0] !== '-@all' ||
    commands.length !== PRIVATE_REDIS_COMMANDS.length + 1 ||
    new Set(commands).size !== commands.length ||
    PRIVATE_REDIS_COMMANDS.some((command) => !commands.includes(`+${command}`))
  ) {
    throw new Error('Private Redis ACL projection unavailable');
  }
};
