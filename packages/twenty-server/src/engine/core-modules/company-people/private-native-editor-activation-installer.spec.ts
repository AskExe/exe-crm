import { type DataSource } from 'typeorm';

import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeStockSetupUncertain } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-identity';

import { installPrivateNativeEditorActivationFunction } from './private-native-editor-activation-installer';
import { PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY } from './private-native-editor-activation-policy';

const catalog = () => [
  { body: PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY, helper: true },
];
const setup = (existing: unknown[] = []) => {
  let installed = false;
  const checkpoint = {
    assertNativeEndpoint: jest.fn(async () => undefined),
    assertCurrent: jest.fn(async () => undefined),
    remainingOriginalWorkMilliseconds: () => 1200,
  } as unknown as PrivateNativeStockActionCheckpoint;
  jest
    .spyOn(PrivateNativeStockActionCheckpoint, 'assertIssued')
    .mockImplementation((value) => {
      if (value !== checkpoint) throw new Error('unissued');
    });
  const runner = {
    isTransactionActive: false,
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => {
      runner.isTransactionActive = true;
    }),
    commitTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    release: jest.fn(async () => undefined),
    query: jest.fn(
      async (sql: string, _parameters?: unknown[]): Promise<unknown> => {
        if (sql.includes('AS ceiling'))
          return [{ identity: true, ceiling: true }];
        if (sql.includes('p.prosrc AS body'))
          return installed ? catalog() : existing;
        if (sql.startsWith('CREATE FUNCTION')) installed = true;
        return [];
      },
    ),
  };
  const database = {
    createQueryRunner: jest.fn(() => runner),
  } as unknown as DataSource;
  return { checkpoint, runner, database };
};
afterEach(() => jest.restoreAllMocks());

describe('protected native editor activation installer', () => {
  it('installs the fixed body and closed ACL transactionally under the original checkpoint', async () => {
    const { checkpoint, runner, database } = setup();
    await installPrivateNativeEditorActivationFunction(checkpoint, database);
    const queries = runner.query.mock.calls.map(([sql]) => sql);
    expect(
      queries.filter((sql) => sql.startsWith('CREATE FUNCTION')),
    ).toHaveLength(1);
    expect(queries.find((sql) => sql.startsWith('CREATE FUNCTION'))).toContain(
      PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY,
    );
    expect(queries.findIndex((sql) => sql.startsWith('REVOKE'))).toBeLessThan(
      queries.findIndex((sql) => sql.startsWith('GRANT')),
    );
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('set_config'),
      ['1200ms', '1000ms'],
    );
    expect(checkpoint.assertNativeEndpoint).toHaveBeenCalledWith(database);
    expect(checkpoint.assertCurrent).toHaveBeenCalled();
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('observes an exact replay without replacing, revoking or granting', async () => {
    const { checkpoint, runner, database } = setup(catalog());
    await installPrivateNativeEditorActivationFunction(checkpoint, database);
    expect(
      runner.query.mock.calls.some(([sql]) =>
        /^(CREATE|REVOKE|GRANT)/.test(sql),
      ),
    ).toBe(false);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['body', [{ body: 'conflict', helper: true }]],
    [
      'owner/signature/ACL',
      [{ body: PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY, helper: false }],
    ],
    ['overload', [...catalog(), ...catalog()]],
  ])('refuses %s drift without mutation', async (_reason, rows) => {
    const { checkpoint, runner, database } = setup(rows as unknown[]);
    await expect(
      installPrivateNativeEditorActivationFunction(checkpoint, database),
    ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect(
      runner.query.mock.calls.some(([sql]) =>
        /^(CREATE|REVOKE|GRANT)/.test(sql),
      ),
    ).toBe(false);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it.each(['identity', 'ceiling'])(
    'refuses excess %s authority before DDL',
    async (key) => {
      const { checkpoint, runner, database } = setup();
      runner.query.mockResolvedValue([
        { identity: key !== 'identity', ceiling: key !== 'ceiling' },
      ]);
      await expect(
        installPrivateNativeEditorActivationFunction(checkpoint, database),
      ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
      expect(
        runner.query.mock.calls.some(([sql]) => sql.startsWith('CREATE')),
      ).toBe(false);
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it('rolls back a revoked checkpoint before any grant', async () => {
    const { checkpoint, runner, database } = setup();
    const query = runner.query.getMockImplementation()!;
    runner.query.mockImplementation(async (sql, parameters) => {
      const result = await query(sql, parameters);
      if (sql.startsWith('CREATE'))
        jest
          .mocked(checkpoint.assertCurrent)
          .mockRejectedValue(new Error('revoked'));
      return result;
    });
    await expect(
      installPrivateNativeEditorActivationFunction(checkpoint, database),
    ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect(
      runner.query.mock.calls.some(([sql]) => sql.startsWith('GRANT')),
    ).toBe(false);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
  it.each(['grant', 'readback', 'role-drift'])(
    'rolls back %s failure after creation',
    async (mode) => {
      const { checkpoint, runner, database } = setup();
      const query = runner.query.getMockImplementation()!;
      let catalogs = 0,
        ceilings = 0;
      runner.query.mockImplementation(async (sql, parameters) => {
        const result = await query(sql, parameters);
        if (sql.startsWith('GRANT') && mode === 'grant')
          throw new Error('grant failed');
        if (
          sql.includes('p.prosrc AS body') &&
          ++catalogs === 2 &&
          mode === 'readback'
        )
          return [{ body: 'changed', helper: true }];
        if (
          sql.includes('AS ceiling') &&
          ++ceilings === 2 &&
          mode === 'role-drift'
        )
          return [{ identity: true, ceiling: false }];
        return result;
      });
      await expect(
        installPrivateNativeEditorActivationFunction(checkpoint, database),
      ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(runner.commitTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledTimes(1);
    },
  );
  it('retains rollback failure beside the original grant failure', async () => {
    const { checkpoint, runner, database } = setup();
    const query = runner.query.getMockImplementation()!;
    const primary = new Error('grant failed'),
      cleanup = new Error('rollback failed');
    runner.query.mockImplementation(async (sql, parameters) => {
      if (sql.startsWith('GRANT')) throw primary;
      return query(sql, parameters);
    });
    runner.rollbackTransaction.mockRejectedValue(cleanup);
    await expect(
      installPrivateNativeEditorActivationFunction(checkpoint, database),
    ).rejects.toMatchObject({ primary, cleanupErrors: [cleanup] });
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('preserves uncertain COMMIT and release failures without compensating DDL', async () => {
    const { checkpoint, runner, database } = setup();
    const primary = new Error('commit unknown'),
      cleanup = new Error('release failed');
    runner.commitTransaction.mockRejectedValue(primary);
    runner.release.mockRejectedValue(cleanup);
    await expect(
      installPrivateNativeEditorActivationFunction(checkpoint, database),
    ).rejects.toMatchObject({ primary, cleanupErrors: [cleanup] });
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(
      runner.query.mock.calls.some(([sql]) => sql.startsWith('DROP')),
    ).toBe(false);
  });
  it('rejects forged checkpoints before connecting', async () => {
    const { database } = setup();
    await expect(
      installPrivateNativeEditorActivationFunction(
        {} as PrivateNativeStockActionCheckpoint,
        database,
      ),
    ).rejects.toThrow('unissued');
    expect(database.createQueryRunner).not.toHaveBeenCalled();
  });
});
