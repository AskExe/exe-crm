import { type DataSource } from 'typeorm';

import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';

import {
  installPrivateNativeCurrentFunction,
  PrivateNativeCurrentInstallationUncertain,
} from './private-native-current-installer';
import { PRIVATE_NATIVE_CURRENT_BODY } from './private-native-current-policy';

const setup = (existing = false) => {
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
    isReleased: false,
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
    release: jest.fn(async () => {
      runner.isReleased = true;
    }),
    query: jest.fn(async (sql: string): Promise<unknown> => {
      if (sql.includes('AS owner')) return [{ owner: true, reader: true }];
      if (sql.startsWith('SELECT oid FROM pg_proc'))
        return existing ? [{ oid: 123 }] : [];
      if (sql.includes('p.prosrc AS body'))
        return [{ body: PRIVATE_NATIVE_CURRENT_BODY, helper: true }];
      return [];
    }),
  };
  const database = {
    createQueryRunner: jest.fn(() => runner),
  } as unknown as DataSource;
  return { checkpoint, runner, database };
};
afterEach(() => jest.restoreAllMocks());

describe('protected native current installer', () => {
  it.each([false, true])(
    'acknowledges installation or exact existing reuse (%s)',
    async (existing) => {
      const { checkpoint, runner, database } = setup(existing);
      await installPrivateNativeCurrentFunction(checkpoint, database);
      const ddl = runner.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => /^(CREATE|REVOKE|GRANT)/.test(sql));
      if (existing) expect(ddl).toEqual([]);
      else {
        expect(ddl).toHaveLength(3);
        expect(ddl[0]).toContain(PRIVATE_NATIVE_CURRENT_BODY);
        expect(ddl[1]).toMatch(/^REVOKE.*FROM PUBLIC/);
        expect(ddl[2]).toMatch(/^GRANT.*TO exe_crm_native_current_reader/);
      }
      expect(checkpoint.assertNativeEndpoint).toHaveBeenCalledWith(database);
      expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['body', 'catalog', 'overload', 'reader'])(
    'refuses %s drift and rolls back without replacing the helper',
    async (mode) => {
      const { checkpoint, runner, database } = setup(true);
      const query = runner.query.getMockImplementation()!;
      runner.query.mockImplementation(async (sql) => {
        if (mode === 'reader' && sql.includes('AS owner'))
          return [{ owner: true, reader: false }];
        if (mode === 'overload' && sql.startsWith('SELECT oid FROM pg_proc'))
          return [{ oid: 123 }, { oid: 124 }];
        if (sql.includes('p.prosrc AS body'))
          return [
            {
              body: mode === 'body' ? 'changed' : PRIVATE_NATIVE_CURRENT_BODY,
              helper: mode !== 'catalog',
            },
          ];
        return query(sql);
      });
      await expect(
        installPrivateNativeCurrentFunction(checkpoint, database),
      ).rejects.toBeInstanceOf(PrivateNativeCurrentInstallationUncertain);
      expect(
        runner.query.mock.calls.some(([sql]) =>
          /^(CREATE|REVOKE|GRANT)/.test(sql),
        ),
      ).toBe(false);
      expect(runner.commitTransaction).not.toHaveBeenCalled();
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['commit', 'rollback'])(
    'retains the exact live runner after lost %s acknowledgment',
    async (mode) => {
      const { checkpoint, runner, database } = setup();
      const primary = new Error('uncertain');
      const cleanup = new Error('rollback acknowledgment lost');
      if (mode === 'commit')
        runner.commitTransaction.mockRejectedValue(primary);
      else {
        runner.query.mockRejectedValue(primary);
        runner.rollbackTransaction.mockRejectedValue(cleanup);
      }
      let failure: unknown;
      try {
        await installPrivateNativeCurrentFunction(checkpoint, database);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(PrivateNativeCurrentInstallationUncertain);
      expect(failure).toMatchObject({
        primary,
        cleanup: mode === 'rollback' ? [cleanup] : [],
        retainedRunner: runner,
        commitAttempted: mode === 'commit',
      });
      expect(runner.isTransactionActive).toBe(true);
      expect(runner.release).not.toHaveBeenCalled();
      if (mode === 'commit')
        expect(runner.rollbackTransaction).not.toHaveBeenCalled();
      expect(Object.keys(failure as Error)).not.toContain('retainedRunner');
    },
  );

  it('rejects an unissued checkpoint before acquiring a runner', async () => {
    const { database } = setup();
    await expect(
      installPrivateNativeCurrentFunction(
        {} as PrivateNativeStockActionCheckpoint,
        database,
      ),
    ).rejects.toThrow('unissued');
    expect(database.createQueryRunner).not.toHaveBeenCalled();
  });
});
