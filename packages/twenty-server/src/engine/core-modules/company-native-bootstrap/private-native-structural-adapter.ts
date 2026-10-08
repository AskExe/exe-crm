import { DataSource, type QueryRunner } from 'typeorm';
import { v5 } from 'uuid';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { writeOriginalStandardPackageFiles } from 'src/engine/core-modules/company-native-bootstrap/private-native-standard-package-storage';
import { PrivateNativeStructuralDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-structural-database-guard';
import { DataSourceEntity } from 'src/engine/metadata-modules/data-source/data-source.entity';

type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

const issuedAdapters = new WeakSet<PrivateNativeStructuralAdapter>();

// Unmounted composition only. Catalog admission is concrete and source-pinned;
// neither service callers nor the entry point can supply an authority callback.
export class PrivateNativeStructuralAdapter {
  private constructor(
    private readonly database: DataSource,
    private readonly fence: PrivateNativeMutationFence,
    private readonly guard: PrivateNativeStructuralDatabaseGuard,
  ) {}

  static async bind(
    database: DataSource,
    fence: PrivateNativeMutationFence,
  ): Promise<PrivateNativeStructuralAdapter> {
    PrivateNativeMutationFence.assertIssued(fence);
    if (
      !(database instanceof DataSource) ||
      !database.isInitialized ||
      database.options.type !== 'postgres' ||
      database.options.synchronize === true ||
      database.options.migrationsRun === true
    )
      throw new PrivateNativeActionUnavailable();
    const pool: unknown = database.options.extra;
    if (
      typeof pool !== 'object' ||
      pool === null ||
      !('max' in pool) ||
      pool.max !== 2 ||
      !('connectionTimeoutMillis' in pool) ||
      pool.connectionTimeoutMillis !== 3000 ||
      !('statement_timeout' in pool) ||
      pool.statement_timeout !== 10000 ||
      !('query_timeout' in pool) ||
      pool.query_timeout !== 10000
    )
      throw new PrivateNativeActionUnavailable();
    await fence.assertOriginalNativeDatabase(database);
    const guard = new PrivateNativeStructuralDatabaseGuard(database);
    await guard.assertCurrent();
    await fence.assertCurrent();
    const adapter = new PrivateNativeStructuralAdapter(database, fence, guard);
    issuedAdapters.add(adapter);
    return adapter;
  }

  static assertIssued(adapter: PrivateNativeStructuralAdapter): void {
    if (!issuedAdapters.has(adapter))
      throw new PrivateNativeActionUnavailable();
  }

  assertComposition(
    database: DataSource,
    fence?: PrivateNativeMutationFence,
  ): void {
    PrivateNativeStructuralAdapter.assertIssued(this);
    if (database !== this.database || fence !== this.fence)
      throw new PrivateNativeActionUnavailable();
  }

  assertFence(fence?: PrivateNativeMutationFence): void {
    PrivateNativeStructuralAdapter.assertIssued(this);
    if (fence !== this.fence) throw new PrivateNativeActionUnavailable();
  }

  async assertWorkspaceCurrent(workspaceId: string): Promise<void> {
    PrivateNativeStructuralAdapter.assertIssued(this);
    await this.fence.assertWorkspaceCurrent(workspaceId);
    await this.fence.assertOriginalNativeDatabase(this.database);
    await this.guard.assertCurrent();
    await this.fence.assertWorkspaceCurrent(workspaceId);
  }

  private async transaction<Result>(
    workspaceId: string,
    operation: (runner: QueryRunner) => Promise<Result>,
  ): Promise<Result> {
    await this.assertWorkspaceCurrent(workspaceId);
    const runner = this.database.createQueryRunner();
    let result: Result | undefined;
    let primary: unknown;
    let failed = false;
    const closure: unknown[] = [];
    try {
      await runner.connect();
      await this.assertWorkspaceCurrent(workspaceId);
      await runner.startTransaction();
      await this.assertWorkspaceCurrent(workspaceId);
      result = await operation(runner);
      await this.assertWorkspaceCurrent(workspaceId);
      await runner.commitTransaction();
      // A refusal after COMMIT remains uncertain and requires quarantine;
      // rollback cannot promise to undo a committed mutation.
      await this.assertWorkspaceCurrent(workspaceId);
    } catch (error) {
      primary = error;
      failed = true;
    } finally {
      if (runner.isTransactionActive) {
        try {
          await runner.rollbackTransaction();
        } catch (error) {
          closure.push(error);
        }
      }
      try {
        await runner.release();
      } catch (error) {
        closure.push(error);
      }
    }
    if (failed) {
      if (closure.length) throw new AggregateError([primary, ...closure]);
      throw primary;
    }
    if (closure.length) throw new AggregateError(closure);
    return result as Result;
  }

  private result(
    value: unknown,
    keys: readonly string[],
  ): Record<string, unknown> {
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      typeof value[0] !== 'object' ||
      value[0] === null ||
      Object.keys(value[0]).length !== 1 ||
      !('result' in value[0]) ||
      typeof value[0].result !== 'object' ||
      value[0].result === null ||
      Array.isArray(value[0].result) ||
      Object.keys(value[0].result).sort().join(',') !==
        [...keys].sort().join(',')
    )
      throw new PrivateNativeActionUnavailable();
    return value[0].result;
  }

  async prepareWorkspace(
    workspaceId: string,
    schemaName: string,
  ): Promise<DataSourceEntity> {
    await this.assertWorkspaceCurrent(workspaceId);
    const original = await this.fence.readOriginalWorkspace();
    if (schemaName !== original.schemaName)
      throw new PrivateNativeActionUnavailable();
    const dataSourceId = v5('private-native-datasource-v1', original.actionId);
    return this.transaction(workspaceId, async (runner) => {
      const result = this.result(
        await runner.query(
          'SELECT core.prepare_original_workspace() AS result',
        ),
        ['actionId', 'workspaceId', 'dataSourceId', 'schemaName'],
      );
      await this.assertWorkspaceCurrent(workspaceId);
      if (
        result.actionId !== original.actionId ||
        result.workspaceId !== workspaceId ||
        result.dataSourceId !== dataSourceId ||
        result.schemaName !== schemaName
      )
        throw new PrivateNativeActionUnavailable();
      const entity = await runner.manager.findOneOrFail(DataSourceEntity, {
        where: { id: dataSourceId, workspaceId, schema: schemaName },
      });
      await this.assertWorkspaceCurrent(workspaceId);
      return entity;
    });
  }

  async createStandardApplication(
    workspaceId: string,
  ): Promise<ApplicationEntity> {
    await this.assertWorkspaceCurrent(workspaceId);
    const original = await this.fence.readOriginalWorkspace();
    const application = await this.transaction(workspaceId, async (runner) => {
      const result = this.result(
        await runner.query(
          'SELECT core.create_original_standard_application() AS result',
        ),
        [
          'actionId',
          'workspaceId',
          'standardApplicationId',
          'packageJsonFileId',
          'yarnLockFileId',
          'packageJsonChecksum',
          'yarnLockChecksum',
        ],
      );
      await this.assertWorkspaceCurrent(workspaceId);
      if (
        result.actionId !== original.actionId ||
        result.workspaceId !== workspaceId ||
        result.standardApplicationId !== original.standardApplicationId ||
        result.packageJsonFileId !==
          v5('private-native-standard-package-json-v1', original.actionId) ||
        result.yarnLockFileId !==
          v5('private-native-standard-yarn-lock-v1', original.actionId) ||
        result.packageJsonChecksum !== 'cbe15a5c1c73b15f40d168ee46ce845d' ||
        result.yarnLockChecksum !== 'fefb6d70e11253c793bf94197d615b45'
      )
        throw new PrivateNativeActionUnavailable();
      const application = await runner.manager.findOneOrFail(
        ApplicationEntity,
        {
          where: { id: original.standardApplicationId, workspaceId },
        },
      );
      await this.assertWorkspaceCurrent(workspaceId);
      await writeOriginalStandardPackageFiles(this.fence);
      await this.assertWorkspaceCurrent(workspaceId);
      return application;
    });
    return application;
  }

  async incrementMetadataVersion(workspaceId: string): Promise<number> {
    await this.assertWorkspaceCurrent(workspaceId);
    const original = await this.fence.readOriginalWorkspace();
    return this.transaction(workspaceId, async (runner) => {
      const result = this.result(
        await runner.query(
          'SELECT core.increment_original_metadata_version() AS result',
        ),
        ['actionId', 'workspaceId', 'oldVersion', 'newVersion'],
      );
      await this.assertWorkspaceCurrent(workspaceId);
      if (
        result.actionId !== original.actionId ||
        result.workspaceId !== workspaceId ||
        typeof result.oldVersion !== 'number' ||
        !Number.isSafeInteger(result.oldVersion) ||
        result.oldVersion < 0 ||
        typeof result.newVersion !== 'number' ||
        !Number.isSafeInteger(result.newVersion) ||
        result.newVersion !== result.oldVersion + 1
      )
        throw new PrivateNativeActionUnavailable();
      return result.newVersion;
    });
  }
}
