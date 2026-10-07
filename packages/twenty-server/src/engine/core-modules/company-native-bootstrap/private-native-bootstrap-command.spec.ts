import { createHash } from 'node:crypto';

import { open, realpath, stat } from 'node:fs/promises';

import { type DataSource } from 'typeorm';

import {
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import {
  assertPrivateNativeRole,
  assertSelectedPrivateNativeProfile,
  readPrivateOperatorBytes,
  runPrivateNativeBootstrap,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-command';

// Compile-time ES2018 shape only; calls still use Node's native constructor.
type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

// Admission controls never invoke allocation; avoid loading its entity graph.
jest.mock(
  'src/engine/core-modules/company-native-bootstrap/private-native-workspace-allocator',
  () => ({
    PrivateNativeWorkspaceAllocator: jest.fn(),
  }),
);

jest.mock('node:fs/promises', () => ({
  open: jest.fn(),
  realpath: jest.fn(),
  stat: jest.fn(),
}));

// Real private entry/role policy methods; synthetic catalog responses only.
// No native connection, protected file, migration or allocator is executed.
describe('private one-shot command admission', () => {
  const query = jest.fn();
  const database = { query } as unknown as DataSource;
  const role = 'owned_native_writer';
  const login = {
    login: role,
    effective: role,
    rolsuper: false,
    rolbypassrls: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    member: false,
    creates_database_objects: false,
    temporary_objects: false,
    database_owner: false,
  };
  const helper = {
    oid: '12345',
    body_matches: true,
    owner_matches: true,
    public_denied: true,
    executable: true,
  };
  const policy = {
    schema_authority: false,
    object_authority: false,
    routine_authority: false,
    type_authority: false,
    column_authority: false,
  };
  beforeEach(() => query.mockReset());

  it('defaults off before reading protected credentials or opening native connections', async () => {
    await expect(runPrivateNativeBootstrap()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
  });

  it('refuses a caller path before any protected file read', async () => {
    await expect(
      readPrivateOperatorBytes('../operator-trust.json'),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });

  it('admits only the bound nonowner writer and the exact column privilege ceiling', async () => {
    query
      .mockResolvedValueOnce([login])
      .mockResolvedValueOnce([helper])
      .mockResolvedValueOnce([policy]);
    await assertPrivateNativeRole(database, role, false);
    expect(query).toHaveBeenCalledTimes(3);
    const parameters = query.mock.calls[2][1];
    expect(parameters[0]).toEqual([
      'privateNativeAction',
      'privateNativeWorkspaceBinding',
      'workspace',
      'user',
      'userWorkspace',
      'application',
      'file',
    ]);
    expect(JSON.parse(parameters[2])).not.toContainEqual([
      'privateNativeAction',
      'actionId',
    ]);
    expect(JSON.parse(parameters[2])).not.toContainEqual([
      'workspace',
      'activationStatus',
    ]);
  });

  it('refuses a server-superuser login before other native admission', async () => {
    query.mockResolvedValueOnce([{ ...login, rolsuper: true }]);
    await expect(
      assertPrivateNativeRole(database, role, false),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refuses effective inherited write privilege on the independent observer', async () => {
    query
      .mockResolvedValueOnce([login])
      .mockResolvedValueOnce([{ ...helper, executable: false }])
      .mockResolvedValueOnce([{ ...policy, column_authority: true }]);
    await expect(
      assertPrivateNativeRole(database, role, true),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('refuses excess writer columns instead of granting or mutating roles', async () => {
    query
      .mockResolvedValueOnce([login])
      .mockResolvedValueOnce([helper])
      .mockResolvedValueOnce([{ ...policy, column_authority: true }]);
    await expect(
      assertPrivateNativeRole(database, role, false),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(
      query.mock.calls.every((call) => String(call[0]).startsWith('SELECT')),
    ).toBe(true);
  });

  it.each(['body_matches', 'owner_matches', 'public_denied'])(
    'refuses changed fixed lock helper %s before a native mutation',
    async (key) => {
      query
        .mockResolvedValueOnce([login])
        .mockResolvedValueOnce([{ ...helper, [key]: false }]);
      await expect(
        assertPrivateNativeRole(database, role, false),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(query).toHaveBeenCalledTimes(2);
      expect(
        query.mock.calls.every((call) => String(call[0]).startsWith('SELECT')),
      ).toBe(true);
    },
  );

  it('refuses database ownership on the otherwise restricted login', async () => {
    query.mockResolvedValueOnce([{ ...login, database_owner: true }]);
    await expect(
      assertPrivateNativeRole(database, role, false),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('admits the observer only with no helper EXECUTE and no writable columns', async () => {
    query
      .mockResolvedValueOnce([login])
      .mockResolvedValueOnce([{ ...helper, executable: false }])
      .mockResolvedValueOnce([policy]);
    await assertPrivateNativeRole(database, role, true);
    expect(query.mock.calls[2][1][1]).toEqual([]);
    expect(JSON.parse(query.mock.calls[2][1][2])).toEqual([]);
  });

  it('preserves a protected read failure before a simultaneous close failure', async () => {
    const primary = new Error('controlled read failure');
    const secondary = new Error('controlled close failure');
    jest
      .mocked(realpath)
      .mockResolvedValue('/run/secrets/crm-native-bootstrap');
    jest.mocked(stat).mockResolvedValue({
      isDirectory: () => true,
      uid: 1000,
      mode: 0o40700,
    } as unknown as Awaited<ReturnType<typeof stat>>);
    const close = jest.fn().mockRejectedValue(secondary);
    jest.mocked(open).mockResolvedValue({
      stat: jest.fn().mockResolvedValue({
        isFile: () => true,
        uid: BigInt(1000),
        nlink: BigInt(1),
        mode: BigInt(0o100400),
        size: BigInt(2),
      }),
      read: jest.fn().mockRejectedValue(primary),
      close,
    } as unknown as Awaited<ReturnType<typeof open>>);
    let observed: unknown;
    try {
      await readPrivateOperatorBytes('configuration.json');
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(AggregateError);
    expect((observed as AggregateError).errors).toEqual([primary, secondary]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

// Parser controls only. Signed mount admission and SQL authority remain separate.
describe('selected native CRM profile bytes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const packageSha = 'a'.repeat(64);
  const build = () => {
    const configuration = {
      version: 'private-native-initializer-v1',
      product: 'crm-workspace',
      image: 'sha256:' + 'b'.repeat(64),
      image_id: 'sha256:' + 'b'.repeat(64),
      source_sha256: 'c'.repeat(64),
      package_sha256: packageSha,
      entrypoint: '/usr/local/bin/node',
      command: [
        'dist/engine/core-modules/company-native-bootstrap/private-native-bootstrap.entry.js',
      ],
      uid: 1000,
      memory_bytes: 1073741824,
      pids_limit: 128,
      cpus: 1,
      storage_target: '/app/.local-storage',
    };
    const bytes = Buffer.from(JSON.stringify(configuration));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const tuple: PrivateNativeActionTuple = {
      company_id: id,
      job_id: id,
      deployment_id: id,
      product: 'crm-workspace',
      request_key: id,
      intent_id: id,
      action_id: id,
      lease_token: id,
      attempt: 1,
      worker_id: 'controlled',
      profile_sha256: 'd'.repeat(64),
      config_sha256: digest,
      initializer_sha256: digest,
    };
    const profile = {
      version: 'company-selected-native-v1',
      company_id: id,
      job_id: id,
      project: 'company-' + id,
      package_sha256: packageSha,
      initializer_sha256: digest,
      configuration,
      native_intent: {
        version: 1,
        company_id: id,
        job_id: id,
        deployment_id: id,
        product: 'crm-workspace',
        request_key: id,
        initializer_sha256: digest,
      },
    };
    return { profile, bytes, tuple };
  };
  it('admits exact selected CRM bytes without full-stack declarations', () => {
    const { profile, bytes, tuple } = build();
    expect(() =>
      assertSelectedPrivateNativeProfile(
        profile,
        bytes,
        bytes,
        tuple,
        packageSha,
      ),
    ).not.toThrow();
  });
  it.each(['configuration', 'initializer'])(
    'refuses changed %s bytes even with the same parsed value',
    (which) => {
      const { profile, bytes, tuple } = build();
      const changed = Buffer.concat([bytes, Buffer.from('\n')]);
      expect(() =>
        assertSelectedPrivateNativeProfile(
          profile,
          which === 'configuration' ? changed : bytes,
          which === 'initializer' ? changed : bytes,
          tuple,
          packageSha,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
    },
  );
  it.each(['deployment_id', 'request_key', 'company_id', 'job_id'])(
    'refuses a foreign signed intent %s',
    (field) => {
      const { profile, bytes, tuple } = build();
      Object.assign(profile.native_intent, {
        [field]: '22222222-2222-4222-8222-222222222222',
      });
      expect(() =>
        assertSelectedPrivateNativeProfile(
          profile,
          bytes,
          bytes,
          tuple,
          packageSha,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
    },
  );
  it.each([
    'uid',
    'memory_bytes',
    'pids_limit',
    'cpus',
    'entrypoint',
    'storage_target',
    'command',
    'version',
    'product',
    'image',
    'image_id',
    'package_sha256',
  ])('refuses changed fixed recipe %s before any connection', (field) => {
    const { profile, tuple } = build();
    const changes: Record<string, unknown> = {
      uid: 1001,
      memory_bytes: 2147483648,
      pids_limit: 129,
      cpus: 2,
      entrypoint: '/usr/bin/node',
      storage_target: '/other-storage',
      command: ['dist/main'],
      version: 'private-erp-three-phase-initializer-v2',
      product: 'erp-site',
      image: 'crm:latest',
      image_id: 'crm:latest',
      package_sha256: 'e'.repeat(64),
    };
    Object.assign(profile.configuration, { [field]: changes[field] });
    const changedBytes = Buffer.from(JSON.stringify(profile.configuration));
    const changedHash = createHash('sha256').update(changedBytes).digest('hex');
    tuple.config_sha256 = tuple.initializer_sha256 = changedHash;
    profile.initializer_sha256 = profile.native_intent.initializer_sha256 =
      changedHash;
    expect(() =>
      assertSelectedPrivateNativeProfile(
        profile,
        changedBytes,
        changedBytes,
        tuple,
        packageSha,
      ),
    ).toThrow(PrivateNativeActionUnavailable);
  });
  it.each(['profile', 'configuration', 'intent'])(
    'refuses extra %s keys',
    (where) => {
      const { profile, bytes, tuple } = build();
      const target =
        where === 'profile'
          ? profile
          : where === 'configuration'
            ? profile.configuration
            : profile.native_intent;
      Object.assign(target, { extra: true });
      expect(() =>
        assertSelectedPrivateNativeProfile(
          profile,
          bytes,
          bytes,
          tuple,
          packageSha,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
    },
  );
  it('refuses reordered configuration rather than silently canonicalizing it', () => {
    const { profile, bytes, tuple } = build();
    profile.configuration = Object.fromEntries(
      Object.entries(profile.configuration).reverse(),
    ) as typeof profile.configuration;
    expect(() =>
      assertSelectedPrivateNativeProfile(
        profile,
        bytes,
        bytes,
        tuple,
        packageSha,
      ),
    ).toThrow(PrivateNativeActionUnavailable);
  });
  it('refuses an ERP or unknown profile without a legacy fallback', () => {
    for (const version of ['company-erp-bootstrap-v1', 'unknown']) {
      const { profile, bytes, tuple } = build();
      profile.version = version;
      expect(() =>
        assertSelectedPrivateNativeProfile(
          profile,
          bytes,
          bytes,
          tuple,
          packageSha,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
    }
  });
});
