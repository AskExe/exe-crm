import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';

import { Client, Pool } from 'pg';
import { DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  PrivateNativeActionUnavailable,
  type PrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { fencePrivateWorkspaceQueries } from 'src/engine/core-modules/company-native-bootstrap/private-native-workspace-query-fence';
import { WorkspaceMigrationRunnerService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/workspace-migration-runner.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

jest.mock('@nestjs/common', () => ({ Injectable: () => () => undefined }), {
  virtual: true,
});
jest.mock(
  '@nestjs/typeorm',
  () => ({ InjectDataSource: () => () => undefined }),
  { virtual: true },
);
jest.mock('src/engine/core-modules/logger/logger.service', () => ({
  LoggerService: class {},
}));
jest.mock(
  'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service',
  () => ({ WorkspaceManyOrAllFlatEntityMapsCacheService: class {} }),
);
jest.mock(
  'src/engine/metadata-modules/workspace-metadata-version/services/workspace-metadata-version.service',
  () => ({ WorkspaceMetadataVersionService: class {} }),
);
jest.mock(
  'src/engine/workspace-cache-storage/workspace-cache-storage.service',
  () => ({ WorkspaceCacheStorageService: class {} }),
);
jest.mock(
  'src/engine/workspace-cache/services/workspace-cache.service',
  () => ({ WorkspaceCacheService: class {} }),
);
jest.mock(
  'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/registry/workspace-migration-runner-action-handler-registry.service',
  () => ({ WorkspaceMigrationRunnerActionHandlerRegistryService: class {} }),
);
jest.mock(
  'src/engine/metadata-modules/flat-entity/utils/get-metadata-related-metadata-names-for-validation.util',
  () => ({ getMetadataRelatedMetadataNamesForValidation: () => [] }),
);
jest.mock(
  'src/engine/metadata-modules/flat-entity/utils/get-metadata-related-metadata-names.util',
  () => ({ getMetadataRelatedMetadataNames: () => [] }),
);
jest.mock(
  'src/engine/metadata-modules/flat-entity/utils/get-metadata-serialized-relation-names.util',
  () => ({ getMetadataSerializedRelationNames: () => [] }),
);
jest.mock(
  'src/engine/metadata-modules/flat-entity/utils/get-metadata-flat-entity-maps-key.util',
  () => ({ getMetadataFlatEntityMapsKey: () => 'flatObjectMetadataMaps' }),
);

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const tuple: PrivateNativeActionTuple = {
  job_id: id('1'),
  lease_token: id('2'),
  attempt: 1,
  worker_id: 'controlled',
  company_id: id('3'),
  deployment_id: id('4'),
  product: 'crm-workspace',
  profile_sha256: '1'.repeat(64),
  config_sha256: '2'.repeat(64),
  initializer_sha256: '3'.repeat(64),
  request_key: id('5'),
  intent_id: id('6'),
  action_id: id('7'),
};
const owner = id('8');
const workspaceId = id('9');

class ControlledClient extends EventEmitter {
  static queries: string[] = [];
  static afterQuery: (() => void) | undefined;
  _queryable = true;
  _ending = false;
  connect(callback: () => void) {
    process.nextTick(callback);
  }
  query(query: string) {
    ControlledClient.queries.push(query);
    ControlledClient.afterQuery?.();
    return Promise.resolve({ rows: [] });
  }
  end(callback?: () => void) {
    this._ending = true;
    process.nextTick(() => {
      this.emit('end');
      callback?.();
    });
  }
}

// Real issued fence + TypeORM/pg runner with inert clients. Synthetic catalog
// responses do not prove SQL permissions, schema provisioning or native success.
describe('original-action workspace query fencing', () => {
  let revoked: boolean;
  let row: Record<string, unknown> | null;
  let nativeQuery: jest.Mock;
  async function issued(workMilliseconds = 10000) {
    const { lease_token: _secret, ...projection } = tuple;
    const worker = {
      query: jest.fn(async () => {
        if (revoked) throw new PrivateNativeActionUnavailable();
        return [
          {
            authority: {
              ...projection,
              owner_subject: owner,
              sql_time: '2026-10-08T00:00:00.000Z',
              lease_expires_at: '2026-10-08T00:10:00.000Z',
            },
          },
        ];
      }),
    } as unknown as DataSource;
    nativeQuery = jest.fn(async (sql: string) =>
      sql.includes('JOIN core.') ? [row] : [{ actionId: tuple.action_id }],
    );
    return PrivateNativeMutationFence.bindCommittedMarker(
      { query: nativeQuery } as unknown as DataSource,
      new PrivateNativeActionReader(worker, true),
      tuple,
      owner,
      performance.now() + workMilliseconds,
      performance.now() + 120000,
      61000,
      'controlled_writer',
    );
  }

  function migrationService(standardApplicationId: string) {
    const queries: string[] = [];
    let active = false;
    const runner = {
      isReleased: false,
      get isTransactionActive() {
        return active;
      },
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async function () {
        await runner.query('BEGIN');
        active = true;
      }),
      commitTransaction: jest.fn(async function () {
        await runner.query('COMMIT');
        active = false;
      }),
      rollbackTransaction: jest.fn(async () => {
        queries.push('ROLLBACK');
        active = false;
      }),
      release: jest.fn(async () => undefined),
    };
    const cache = {
      getOrRecompute: jest.fn(async () => ({
        flatApplicationMaps: {
          byId: { [standardApplicationId]: { id: standardApplicationId } },
          idByUniversalIdentifier: { standard: standardApplicationId },
        },
      })),
      invalidateAndRecompute: jest.fn(async () => undefined),
    };
    const flat = {
      getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(async () => ({})),
      invalidateFlatEntityMaps: jest.fn(async () => undefined),
    };
    const execute = jest.fn(async () => {
      await runner.query('CREATE controlled');
      return { partialOptimisticCache: {}, metadataEvents: [] };
    });
    const rollback = jest.fn();
    const logger = { time: jest.fn(), timeEnd: jest.fn(), error: jest.fn() };
    const service = new WorkspaceMigrationRunnerService(
      flat as never,
      { createQueryRunner: () => runner } as never,
      {
        executeActionHandler: execute,
        executeActionRollbackHandler: rollback,
      } as never,
      { incrementMetadataVersion: jest.fn(async () => undefined) } as never,
      { flushGraphQLOperation: jest.fn(async () => undefined) } as never,
      cache as never,
      logger as never,
    );
    const args = {
      workspaceId,
      workspaceMigration: {
        applicationUniversalIdentifier: 'standard',
        actions: [{ metadataName: 'objectMetadata' }],
      },
    };
    return {
      service,
      runner,
      cache,
      flat,
      execute,
      rollback,
      logger,
      args,
      queries,
    };
  }
  it('ordinary migration keeps the original transaction and compensating action path', async () => {
    const m = migrationService(id('c'));
    const primary = new Error('controlled action');
    m.execute.mockRejectedValue(primary);
    await expect(m.service.run(m.args as never)).rejects.toThrow(
      'controlled action',
    );
    expect(m.runner.connect).toHaveBeenCalledTimes(1);
    expect(m.runner.startTransaction).toHaveBeenCalledTimes(1);
    expect(m.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(m.rollback).toHaveBeenCalledTimes(1);
    expect(m.runner.release).toHaveBeenCalledTimes(1);
    expect(nativeQuery).toBeUndefined();
  });
  it('ordinary successful commit retains its legacy cache-error logging behavior', async () => {
    const m = migrationService(id('c'));
    m.flat.invalidateFlatEntityMaps.mockRejectedValue(
      new Error('controlled cache'),
    );
    await expect(m.service.run(m.args as never)).resolves.toHaveProperty(
      'hasSchemaMetadataChanged',
      true,
    );
    expect(m.runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(m.runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(m.runner.release).toHaveBeenCalledTimes(1);
    expect(m.logger.error).toHaveBeenCalledTimes(1);
  });
  it('private expiry after awaited mutation refuses completion and safely closes owned runner', async () => {
    const fence = await issued(500);
    const original = await fence.readOriginalWorkspace();
    const m = migrationService(original.standardApplicationId);
    m.runner.query.mockImplementation(async (sql) => {
      m.queries.push(sql);
      if (sql === 'CREATE controlled')
        await new Promise((resolve) => setTimeout(resolve, 550));
    });
    await expect(
      m.service.run({ ...m.args, privateFence: fence } as never),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(m.queries).toEqual(['BEGIN', 'CREATE controlled', 'ROLLBACK']);
    expect(m.runner.release).toHaveBeenCalledTimes(1);
    expect(m.rollback).not.toHaveBeenCalled();
  });
  it.each(['action', 'commit', 'cache', 'post-IO'])(
    'private %s failure propagates with terminal closure and no compensating DDL',
    async (phase) => {
      const fence = await issued();
      const original = await fence.readOriginalWorkspace();
      const m = migrationService(original.standardApplicationId);
      const primary = new Error('controlled primary');
      if (phase === 'action') m.execute.mockRejectedValue(primary);
      if (phase === 'commit')
        m.runner.commitTransaction.mockRejectedValue(primary);
      if (phase === 'cache')
        m.flat.invalidateFlatEntityMaps.mockRejectedValue(primary);
      if (phase === 'post-IO')
        m.runner.query.mockImplementation(async (sql) => {
          m.queries.push(sql);
          if (sql === 'CREATE controlled') revoked = true;
        });
      const run = m.service.run({ ...m.args, privateFence: fence } as never);
      if (phase === 'post-IO')
        await expect(run).rejects.toBeInstanceOf(
          PrivateNativeActionUnavailable,
        );
      else await expect(run).rejects.toBe(primary);
      expect(m.rollback).not.toHaveBeenCalled();
      expect(m.runner.release).toHaveBeenCalledTimes(1);
      expect(m.runner.rollbackTransaction).toHaveBeenCalledTimes(
        phase === 'cache' ? 0 : 1,
      );
    },
  );
  it('retains primary before both rollback and release failures', async () => {
    const fence = await issued();
    const original = await fence.readOriginalWorkspace();
    const m = migrationService(original.standardApplicationId);
    const primary = new Error('primary'),
      rollback = new Error('rollback'),
      release = new Error('release');
    m.execute.mockRejectedValue(primary);
    m.runner.rollbackTransaction.mockRejectedValue(rollback);
    m.runner.release.mockRejectedValue(release);
    const error = await m.service
      .run({ ...m.args, privateFence: fence } as never)
      .catch((error) => error);
    expect(error.errors).toEqual([primary, rollback, release]);
    expect(m.runner.release).toHaveBeenCalledTimes(1);
    expect(m.rollback).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.useRealTimers();
    revoked = false;
    nativeQuery = undefined as unknown as jest.Mock;
    row = {
      actionId: tuple.action_id,
      workspaceId,
      userId: id('a'),
      userWorkspaceId: id('b'),
      applicationId: id('c'),
      ownerSubject: owner,
      databaseSchema: null,
    };
    ControlledClient.queries = [];
    ControlledClient.afterQuery = undefined;
    jest
      .spyOn(PrivateNativeDatabaseGuard.prototype, 'assertCurrent')
      .mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  it('derives immutable selectors from committed binding and refuses later ID drift', async () => {
    const fence = await issued();
    const original = await fence.readOriginalWorkspace();
    expect(
      nativeQuery.mock.calls.find(([sql]) => sql.includes('JOIN core.'))?.[0],
    ).toContain('a."plannedWorkspaceId" AS "workspaceId"');
    expect(original.schemaName).toBe(getWorkspaceSchemaName(workspaceId));
    expect(Object.isFrozen(original)).toBe(true);
    expect(original.standardApplicationId).not.toBe(
      original.customApplicationId,
    );
    await expect(fence.assertWorkspaceCurrent(id('d'))).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    row = { ...row, userId: id('e') };
    await expect(fence.readOriginalWorkspace()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
  });
  it.each([
    null,
    { workspaceId: 'foreign' },
    { databaseSchema: 'foreign_schema' },
  ])('refuses malformed or foreign binding %p', async (changed) => {
    const fence = await issued();
    row = changed === null ? null : { ...row, ...changed };
    await expect(fence.readOriginalWorkspace()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
  });
  it('refuses a caller-supplied checkpoint object before touching runner', async () => {
    const runner = { query: jest.fn() } as unknown as ReturnType<
      DataSource['createQueryRunner']
    >;
    await expect(
      fencePrivateWorkspaceQueries(
        runner,
        {
          assertWorkspaceCurrent: jest.fn(),
        } as unknown as PrivateNativeMutationFence,
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(runner.query).not.toHaveBeenCalled();
  });
  it.each(['DDL', 'metadata', 'COMMIT'])(
    'checks original owner before and after actual runner %s and releases every client',
    async (phase) => {
      const fence = await issued();
      const pool = new Pool({
        max: 1,
        Client: ControlledClient as unknown as typeof Client,
      });
      const database = new DataSource({ type: 'postgres', logging: false });
      (database.driver as unknown as { master: Pool }).master = pool;
      (database as unknown as { isInitialized: boolean }).isInitialized = true;
      const runner = database.createQueryRunner();
      const restore = await fencePrivateWorkspaceQueries(
        runner,
        fence,
        workspaceId,
      );
      try {
        await runner.connect();
        await runner.startTransaction();
        const target =
          phase === 'DDL'
            ? 'CREATE TABLE controlled'
            : phase === 'metadata'
              ? 'INSERT controlled'
              : 'COMMIT';
        ControlledClient.afterQuery = () => {
          revoked = true;
        };
        await expect(
          phase === 'COMMIT'
            ? runner.commitTransaction()
            : runner.query(target),
        ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
        expect(
          ControlledClient.queries[ControlledClient.queries.length - 1],
        ).toBe(target);
        const count = ControlledClient.queries.length;
        await expect(runner.query('FOREIGN')).rejects.toBeInstanceOf(
          PrivateNativeActionUnavailable,
        );
        expect(ControlledClient.queries).toHaveLength(count);
      } finally {
        restore();
        ControlledClient.afterQuery = undefined;
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
        await pool.end();
      }
      expect(pool.totalCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
      expect(ControlledClient.queries).not.toContain('FOREIGN');
    },
  );
});
