import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants, fstatSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { DataSource } from 'typeorm';

import {
  PrivateDispatchLifetime,
  readPrivateFirstWriterFrame,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-frame';

import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import {
  PrivateNativeActionReader,
  PrivateNativeActionUnavailable,
  snapshotPrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeWorkspaceAllocator } from 'src/engine/core-modules/company-native-bootstrap/private-native-workspace-allocator';
import { PrivateNativeWorkspaceObserver } from 'src/engine/core-modules/company-native-bootstrap/private-native-workspace-observer';

// Compile-time ES2018 shape only; calls still use Node's native constructor.
type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

// This module is not registered in Nest/HTTP/worker. Only a reviewed one-shot
// private process may call it. These exact operator mounts are not tenant input.
const INPUT_ROOT = '/run/secrets/crm-native-bootstrap';
const STORAGE_ROOT = '/app/.local-storage';
const HASH = /^[0-9a-f]{64}$/;
const SECRET_NAMES = [
  'core-worker',
  'native-writer',
  'native-observer',
] as const;
const OWNER_UID = 1000;

function refuse(ok: unknown): asserts ok {
  if (!ok) throw new PrivateNativeActionUnavailable();
}
function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function closed(value: unknown, keys: string[]): Record<string, unknown> {
  refuse(
    value !== null &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  refuse(Reflect.ownKeys(value).length === keys.length);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    refuse(field && field.enumerable && 'value' in field);
    out[key] = field.value;
  }
  return out;
}

export async function readPrivateOperatorBytes(name: string): Promise<Buffer> {
  // O_NOFOLLOW binds the final file. Exact real parent refuses alias mounts;
  // mount provenance/immutability still requires the outer package controller.
  refuse(/^[a-z-]+\.(json|sig)$/.test(name));
  refuse((await realpath(INPUT_ROOT)) === INPUT_ROOT);
  const parent = await stat(INPUT_ROOT);
  refuse(
    parent.isDirectory() &&
      parent.uid === OWNER_UID &&
      (parent.mode & 0o7777) === 0o700,
  );
  const handle = await open(
    join(INPUT_ROOT, name),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let primary: unknown;
  try {
    const before = await handle.stat({ bigint: true });
    refuse(
      before.isFile() &&
        before.uid === BigInt(OWNER_UID) &&
        before.nlink === BigInt(1) &&
        (before.mode & BigInt(0o177777)) === BigInt(0o100400) &&
        before.size > BigInt(0) &&
        before.size <= BigInt(65536),
    );
    const bytes = Buffer.alloc(Number(before.size));
    const read = await handle.read(bytes, 0, bytes.length, 0);
    refuse(read.bytesRead === bytes.length);
    const after = await handle.stat({ bigint: true });
    refuse(
      [
        'dev',
        'ino',
        'mode',
        'uid',
        'nlink',
        'size',
        'mtimeNs',
        'ctimeNs',
      ].every(
        (key) =>
          before[key as keyof typeof before] ===
          after[key as keyof typeof after],
      ),
    );
    return bytes;
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      throw new AggregateError(
        primary === undefined ? [error] : [primary, error],
        'Private protected file unavailable',
      );
    }
  }
}

function privateConnection(bytes: Buffer, expectedRole: string): string {
  const value = closed(JSON.parse(bytes.toString('utf8')), ['url']);
  refuse(typeof value.url === 'string' && value.url.length <= 2048);
  const url = new URL(value.url);
  refuse(
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
      decodeURIComponent(url.username) === expectedRole &&
      url.password.length > 0 &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.length > 1,
  );
  return value.url;
}

export async function assertPrivateNativeRole(
  database: DataSource,
  role: string,
  readOnly: boolean,
): Promise<void> {
  await new PrivateNativeDatabaseGuard(
    database,
    role,
    readOnly,
  ).assertCurrent();
}

// No automatic CLI activation or provider callback. Default-off must be
// enabled explicitly by the protected operator trust artifact and private call.
export async function runPrivateNativeBootstrap(enabled = false) {
  refuse(enabled && process.getuid?.() === OWNER_UID);
  const start = performance.now();
  let wholeDeadline = start + 181000;
  refuse(fstatSync(0).isFIFO());
  const frame = await readPrivateFirstWriterFrame(process.stdin);
  const lifetime = new PrivateDispatchLifetime(frame, wholeDeadline);
  const trust = closed(
    JSON.parse(
      (await readPrivateOperatorBytes('operator-trust.json')).toString('utf8'),
    ),
    [
      'enabled',
      'signer_spki_hex',
      'signer_sha256',
      'profile_sha256',
      'config_sha256',
      'initializer_sha256',
      'package_sha256',
      'command_context_sha256',
      'native_writer_role',
      'native_observer_role',
      'core_worker_role',
    ],
  );
  refuse(trust.enabled === true);
  for (const key of [
    'signer_sha256',
    'profile_sha256',
    'config_sha256',
    'initializer_sha256',
    'package_sha256',
    'command_context_sha256',
  ]) {
    refuse(typeof trust[key] === 'string' && HASH.test(trust[key] as string));
  }
  refuse(
    typeof trust.signer_spki_hex === 'string' &&
      /^[0-9a-f]{88}$/.test(trust.signer_spki_hex),
  );
  const spki = Buffer.from(trust.signer_spki_hex, 'hex');
  refuse(sha(spki) === trust.signer_sha256);
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  refuse(key.asymmetricKeyType === 'ed25519');
  const profileBytes = await readPrivateOperatorBytes('profile.json');
  const configBytes = await readPrivateOperatorBytes('configuration.json');
  const signature = await readPrivateOperatorBytes('profile.sig');
  refuse(
    signature.length === 64 &&
      sha(profileBytes) === trust.profile_sha256 &&
      sha(configBytes) === trust.config_sha256 &&
      verify(null, profileBytes, key, signature),
  );
  const profileIdentity = closed(JSON.parse(profileBytes.toString('utf8')), [
    'version',
    'company_id',
    'job_id',
    'project',
    'artifact_root',
    'artifacts',
    'services',
    'volumes',
    'networks',
    'wiki',
    'package_sha256',
    'quota_sha256',
    'native_intent',
  ]);
  const serviceNames = [
    'postgres',
    'redis',
    'crm',
    'crm-worker',
    'erp',
    'erp-queue',
    'erp-scheduler',
    'erp-socket',
    'erp-nginx',
    'wiki',
    'database-init',
    'erp-configurator',
  ];
  const services = closed(profileIdentity.services, serviceNames);
  // Exact Core runtime-profile configuration digest projection, not a new
  // interpretation of its configuration hash or whole structural validator.
  const configuration = serviceNames.map((name) => {
    const service = services[name] as Record<string, unknown>;
    return [
      name,
      service.environment,
      service.depends_on,
      service.healthcheck,
      service.tmpfs,
      service.image_volumes,
    ];
  });
  refuse(Buffer.from(JSON.stringify(configuration)).equals(configBytes));
  const contextBytes = await readPrivateOperatorBytes('command-context.json');
  refuse(sha(contextBytes) === trust.command_context_sha256);
  // This command consumes exact operator-reviewed bytes; it does not replace
  // Core's full runtime-profile policy or qualify its services/quotas.
  const config = closed(JSON.parse(contextBytes.toString('utf8')), [
    'version',
    'company_id',
    'job_id',
    'storage_root',
    'package_sha256',
    'native_host',
    'native_port',
    'native_database',
  ]);
  const tuple = snapshotPrivateNativeActionTuple(frame.tuple);
  refuse(
    config.version === 1 &&
      config.company_id === tuple.company_id &&
      config.job_id === tuple.job_id &&
      config.storage_root === STORAGE_ROOT &&
      config.package_sha256 === trust.package_sha256 &&
      profileIdentity?.company_id === tuple.company_id &&
      profileIdentity?.job_id === tuple.job_id &&
      profileIdentity.version === 'company-isolated-v2' &&
      profileIdentity.project === 'company-' + tuple.company_id &&
      profileIdentity.package_sha256 === trust.package_sha256 &&
      tuple.profile_sha256 === trust.profile_sha256 &&
      tuple.config_sha256 === trust.config_sha256 &&
      tuple.initializer_sha256 === trust.initializer_sha256,
  );
  const intent = closed(profileIdentity.native_intent, [
    'version',
    'company_id',
    'job_id',
    'products',
  ]);
  refuse(
    intent.version === 2 &&
      intent.company_id === tuple.company_id &&
      intent.job_id === tuple.job_id &&
      Array.isArray(intent.products) &&
      intent.products.length === 3,
  );
  const crm = closed(intent.products[0], [
    'kind',
    'request_key',
    'initializer_sha256',
  ]);
  refuse(
    crm.kind === tuple.product &&
      crm.request_key === tuple.request_key &&
      crm.initializer_sha256 === tuple.initializer_sha256,
  );
  const initializerBytes = await readPrivateOperatorBytes('initializer.json');
  refuse(sha(initializerBytes) === tuple.initializer_sha256);
  const roles = [
    trust.core_worker_role,
    trust.native_writer_role,
    trust.native_observer_role,
  ];
  refuse(
    roles.every(
      (role) =>
        typeof role === 'string' &&
        /^[a-z][a-z0-9_]{0,62}$/.test(role as string),
    ) && new Set(roles).size === roles.length,
  );
  refuse((await realpath(STORAGE_ROOT)) === STORAGE_ROOT);
  const storage = await stat(STORAGE_ROOT);
  refuse(
    storage.isDirectory() &&
      storage.uid === OWNER_UID &&
      (storage.mode & 0o7777) === 0o700,
  );
  const urls = await Promise.all(
    SECRET_NAMES.map((name, index) =>
      readPrivateOperatorBytes(name + '.json').then((bytes) =>
        privateConnection(bytes, roles[index] as string),
      ),
    ),
  );
  refuse(
    typeof config.native_host === 'string' &&
      /^[a-z0-9][a-z0-9.-]{0,127}$/.test(config.native_host) &&
      Number.isSafeInteger(config.native_port) &&
      (config.native_port as number) > 0 &&
      (config.native_port as number) <= 65535 &&
      typeof config.native_database === 'string' &&
      /^[a-z][a-z0-9_]{0,62}$/.test(config.native_database),
  );
  for (const url of urls.slice(1)) {
    const native = new URL(url);
    refuse(
      native.hostname === config.native_host &&
        Number(native.port || 5432) === config.native_port &&
        decodeURIComponent(native.pathname.slice(1)) === config.native_database,
    );
  }
  const common = {
    type: 'postgres' as const,
    logging: false as const,
    synchronize: false,
    migrationsRun: false,
    extra: {
      max: 1,
      connectionTimeoutMillis: 3000,
      query_timeout: 10000,
      statement_timeout: 10000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 10000,
    },
  };
  const core = new DataSource({ ...common, url: urls[0] });
  const independentCore = new DataSource({ ...common, url: urls[0] });
  // Match the stock billing-disabled entity closure without dotenv/AppModule.
  const entities = [
    join(dirname(__dirname), '**/!(billing-*).entity.js'),
    join(__dirname, '../../metadata-modules/**/*.entity.js'),
  ];
  const writer = new DataSource({
    ...common,
    url: urls[1],
    schema: 'core',
    entities,
  });
  const observer = new DataSource({ ...common, url: urls[2], schema: 'core' });
  const opened: DataSource[] = [];
  let primary: unknown;
  try {
    for (const database of [core, independentCore, writer, observer]) {
      await database.initialize();
      opened.push(database);
      refuse(performance.now() < wholeDeadline - 61000);
    }
    const writerAuthority = new PrivateNativeActionReader(core, true, lifetime);
    const observerAuthority = new PrivateNativeActionReader(
      independentCore,
      true,
      lifetime,
    );
    await writerAuthority.read(tuple, 61001);
    wholeDeadline = lifetime.workEnd();
    await assertPrivateNativeRole(writer, roles[1] as string, false);
    await assertPrivateNativeRole(observer, roles[2] as string, true);
    refuse(performance.now() < wholeDeadline - 61000);
    const pending = await new PrivateNativeWorkspaceAllocator(
      writer,
      writerAuthority,
      STORAGE_ROOT,
      trust.package_sha256 as string,
      roles[1] as string,
      true,
    ).allocatePending(
      tuple,
      Math.floor(wholeDeadline - performance.now() - 61000),
    );
    const observed = await new PrivateNativeWorkspaceObserver(
      observer,
      observerAuthority,
      trust.package_sha256 as string,
      roles[2] as string,
      true,
    ).observe(tuple);
    refuse(
      performance.now() < wholeDeadline - 30000 &&
        observed.workspaceId === pending.workspaceId &&
        observed.userId === pending.userId &&
        observed.userWorkspaceId === pending.userWorkspaceId &&
        observed.actionId === pending.actionId,
    );
    return Object.freeze({ ...pending, readiness: 'unverified' as const });
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    const errors: unknown[] = [];
    for (const database of opened.reverse()) {
      try {
        await database.destroy();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        primary === undefined ? errors : [primary, ...errors],
        'Private native command unavailable',
      );
  }
}
