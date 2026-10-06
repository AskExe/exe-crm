import { ConfigService } from '@nestjs/config';

import { ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import {
  COMPANY_UUID,
  type CompanyAuthConfiguration,
  type CompanyNativeBinding,
} from 'src/engine/core-modules/company-auth/company-auth.config';
import {
  privatePeopleConnectionUrl,
  PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
} from './private-people-pool-options';
import { closedPeopleMessage } from './private-people-protocol';
import { readPrivatePeopleProtectedBytes } from './private-people-worker-package';

const ROOT = '/run/secrets/crm-people-worker';
const canonical = (
  name:
    | 'runtime-profile.json'
    | 'metadata-connection.json'
    | 'writer-connection.json'
    | 'redis-connection.json',
) => {
  const bytes = readPrivatePeopleProtectedBytes(ROOT + '/' + name, 1000, 65536);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(value) !== bytes.toString('utf8'))
    throw new Error('Private assembly canonical configuration unavailable');
  return value;
};
const connection = (
  name: 'metadata-connection.json' | 'writer-connection.json',
  user: string,
) => {
  const value = canonical(name);
  if (
    !closedPeopleMessage(value, [
      'host',
      'port',
      'database',
      'username',
      'password',
    ]) ||
    typeof value.host !== 'string' ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(value.host) ||
    !Number.isInteger(value.port) ||
    value.port !== 5432 ||
    typeof value.database !== 'string' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(value.database) ||
    value.username !== user ||
    typeof value.password !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.password)
  )
    throw new Error(
      'Private assembly fixed database configuration unavailable',
    );
  return Object.freeze({
    host: value.host,
    port: 5432,
    database: value.database,
    username: user,
    password: value.password,
  });
};

// Only fixed protected files, never process configuration/envfiles/public flags.
export const readPrivatePeopleAssemblyConfiguration = () => {
  if (
    process.platform !== 'linux' ||
    process.getuid?.() !== 1000 ||
    Object.keys(process.env).some(
      (key) => !['PATH', 'NODE_ENV'].includes(key),
    ) ||
    process.env.NODE_ENV !== 'production'
  )
    throw new Error('Private assembly environment unavailable');
  const profile = canonical('runtime-profile.json');
  const keys = [
    'version',
    'enabled',
    'companyId',
    'workspaceId',
    'nativeSchema',
    'bindingId',
    'generationId',
    'audience',
    'clientId',
    'origin',
    'brokerUrl',
    'authorityUrl',
    'clientSecret',
    'bindings',
  ];
  if (
    !closedPeopleMessage(profile, keys) ||
    profile.version !== 1 ||
    profile.enabled !== true
  )
    throw new Error('Private assembly disabled');
  for (const key of ['companyId', 'workspaceId', 'bindingId', 'generationId'])
    if (typeof profile[key] !== 'string' || !COMPANY_UUID.test(profile[key]))
      throw new Error('Private assembly binding unavailable');
  for (const key of ['audience', 'clientId'])
    if (
      typeof profile[key] !== 'string' ||
      !/^[a-z][a-z0-9_-]{1,127}$/.test(profile[key])
    )
      throw new Error('Private assembly audience unavailable');
  if (
    typeof profile.nativeSchema !== 'string' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(profile.nativeSchema) ||
    typeof profile.origin !== 'string' ||
    !/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(profile.origin) ||
    typeof profile.clientSecret !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(profile.clientSecret)
  )
    throw new Error('Private assembly configuration unavailable');
  for (const key of ['brokerUrl', 'authorityUrl'])
    if (
      typeof profile[key] !== 'string' ||
      !/^http:\/\/[a-z][a-z0-9-]{0,62}:[1-9][0-9]{0,4}$/.test(profile[key]) ||
      Number(new URL(profile[key]).port) > 65535
    )
      throw new Error('Private assembly authority unavailable');
  if (
    !Array.isArray(profile.bindings) ||
    profile.bindings.length < 1 ||
    profile.bindings.length > 100
  )
    throw new Error('Private assembly native binding unavailable');
  const bindings = new Map<string, CompanyNativeBinding>();
  const users = new Set<string>();
  for (const row of profile.bindings) {
    if (
      !closedPeopleMessage(row, [
        'subject_id',
        'user_id',
        'user_workspace_id',
        'workspace_member_id',
      ]) ||
      !Object.values(row).every(
        (v) => typeof v === 'string' && COMPANY_UUID.test(v),
      ) ||
      typeof row.subject_id !== 'string' ||
      typeof row.user_id !== 'string' ||
      typeof row.user_workspace_id !== 'string' ||
      typeof row.workspace_member_id !== 'string' ||
      bindings.has(row.subject_id) ||
      users.has(row.user_id)
    )
      throw new Error('Private assembly native binding unavailable');
    bindings.set(
      row.subject_id,
      Object.freeze({
        subject_id: row.subject_id,
        user_id: row.user_id,
        user_workspace_id: row.user_workspace_id,
        workspace_member_id: row.workspace_member_id,
      }),
    );
    users.add(row.user_id);
  }
  // Each string below passed the closed profile guards above; loop guards
  // validate indexed fields without retaining their TypeScript narrowing.
  const configuration: CompanyAuthConfiguration = Object.freeze({
    companyId: profile.companyId as string,
    workspaceId: profile.workspaceId as string,
    nativeSchema: profile.nativeSchema,
    bindingId: profile.bindingId as string,
    generationId: profile.generationId as string,
    audience: profile.audience as string,
    clientId: profile.clientId as string,
    origin: profile.origin,
    brokerUrl: profile.brokerUrl as string,
    authorityUrl: profile.authorityUrl as string,
    clientSecret: profile.clientSecret,
    bindings,
  });
  const metadata = connection(
    'metadata-connection.json',
    'crm_people_metadata',
  );
  const writer = connection('writer-connection.json', 'crm_people_writer');
  if (metadata.host !== writer.host || metadata.database !== writer.database)
    throw new Error('Private assembly database binding unavailable');
  const redis = canonical('redis-connection.json');
  if (
    !closedPeopleMessage(redis, [
      'host',
      'port',
      'username',
      'password',
      'database',
    ]) ||
    typeof redis.host !== 'string' ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(redis.host) ||
    redis.port !== 6379 ||
    redis.username !== 'crm_people_cache' ||
    typeof redis.password !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(redis.password) ||
    redis.database !== 0
  )
    throw new Error('Private assembly dedicated Redis unavailable');
  const redisConfiguration = Object.freeze({
    host: redis.host,
    port: 6379,
    username: 'crm_people_cache',
    password: redis.password,
    database: 0,
  });
  const defaults = new ConfigVariables();
  const fixed = Object.freeze({
    ...defaults,
    NODE_ENV: 'production',
    IS_CONFIG_VARIABLES_IN_DB_ENABLED: false,
    PG_DATABASE_URL: privatePeopleConnectionUrl(writer),
    PG_DATABASE_REPLICA_URL: undefined,
    PG_SSL_ALLOW_SELF_SIGNED: false,
    PG_POOL_MAX_CONNECTIONS: 1,
    PG_POOL_IDLE_TIMEOUT_MS: 1000,
    PG_POOL_ALLOW_EXIT_ON_IDLE: true,
    PG_DATABASE_PRIMARY_TIMEOUT_MS: PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
    CACHE_STORAGE_TTL: 1,
  });
  // Pinned Config3.3 validated values have priority over environment/internal.
  // Closed environment also prevents fallback for optional undefined keys.
  const config = new ConfigService({ _PROCESS_ENV_VALIDATED: fixed });
  const driver = new EnvironmentConfigDriver(config, defaults);
  return { configuration, metadata, writer, redis: redisConfiguration, driver };
};
