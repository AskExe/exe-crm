import { open, realpath, stat } from 'node:fs/promises';

import { type DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import {
  assertPrivateNativeRole,
  readPrivateOperatorBytes,
  runPrivateNativeBootstrap,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-command';

// Compile-time ES2018 shape only; calls still use Node's native constructor.
type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

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
