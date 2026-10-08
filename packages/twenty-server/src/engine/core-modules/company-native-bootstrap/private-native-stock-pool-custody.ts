import { type DataSource, type QueryRunner } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { fencePrivateStockQueryRunner } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-query-fence';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';

export const PRIVATE_NATIVE_STOCK_POOL_CUSTODY = Symbol(
  'private-native-stock-pool-custody',
);

const issuedStockPools = new WeakSet<PrivateNativeStockPoolCustody>();

// Owns only the native core pool and one native record pool for the sole binding.
// Catalog checks use the original separate control seam, not either stock pool.
export class PrivateNativeStockPoolCustody {
  readonly #owned = new Set<DataSource>();
  readonly #initializing = new Set<DataSource>();
  readonly #withdrawn = new Set<DataSource>();
  #terminal = false;
  readonly #fenceFailures: unknown[] = [];

  private constructor(
    private readonly primary: DataSource,
    private readonly control: PrivateNativeStockRoleGuard,
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
  ) {}

  static async bind(
    primary: DataSource,
    control: PrivateNativeStockRoleGuard,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<PrivateNativeStockPoolCustody> {
    if (
      !primary.isInitialized ||
      primary.options.type !== 'postgres' ||
      primary.options.synchronize ||
      primary.options.migrationsRun ||
      primary.options.dropSchema ||
      primary.options.poolSize !== 1
    )
      throw new PrivateNativeActionUnavailable();
    await control.assertBusinessDatabase(primary, checkpoint);
    const custody = new PrivateNativeStockPoolCustody(
      primary,
      control,
      checkpoint,
    );
    issuedStockPools.add(custody);
    custody.#owned.add(primary);
    custody.install(primary);
    return custody;
  }

  static assertIssued(custody: PrivateNativeStockPoolCustody): void {
    if (!issuedStockPools.has(custody))
      throw new PrivateNativeActionUnavailable();
  }

  assertBinding(
    database: DataSource,
    control: PrivateNativeStockRoleGuard,
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): void {
    PrivateNativeStockPoolCustody.assertIssued(this);
    if (
      this.#terminal ||
      this.primary !== database ||
      this.control !== control ||
      this.checkpoint !== checkpoint
    )
      throw new PrivateNativeActionUnavailable();
  }

  private install(database: DataSource): void {
    const original = database.createQueryRunner.bind(database);
    database.createQueryRunner = (mode) => {
      if (this.#terminal || !this.#owned.has(database))
        throw new PrivateNativeActionUnavailable();
      const runner: QueryRunner = original(mode);
      // The fence captures the real query synchronously. Consumers see only a
      // gate until asynchronous original-action/catalog qualification completes.
      const ready = fencePrivateStockQueryRunner(
        database,
        runner,
        this.checkpoint,
        this.control,
      );
      void ready.catch((error) => this.#fenceFailures.push(error));
      const gate: QueryRunner['query'] = async (
        ...args: [string, unknown[]?, boolean?]
      ) => {
        await ready;
        if (runner.query === gate) throw new PrivateNativeActionUnavailable();
        return Reflect.apply(runner.query, runner, args);
      };
      runner.query = gate;
      return runner;
    };
  }

  async initialize(database: GlobalWorkspaceDataSource): Promise<void> {
    if (
      this.#terminal ||
      !(database instanceof GlobalWorkspaceDataSource) ||
      database.coreDataSource !== this.primary ||
      this.#owned.size !== 1 ||
      this.#initializing.size ||
      database.isInitialized ||
      database.options.type !== 'postgres' ||
      database.options.synchronize ||
      database.options.migrationsRun ||
      database.options.dropSchema ||
      database.options.poolSize !== 1
    )
      throw new PrivateNativeActionUnavailable();
    this.#initializing.add(database);
    try {
      await this.checkpoint.assertCurrent();
      // synchronize/migrations/drop are refused: driver initialization performs
      // no setup DDL before the endpoint and fixed-role admission below.
      await database.initialize();
      await this.checkpoint.assertCurrent();
      await this.control.bindBusinessDatabase(database);
      this.#owned.add(database);
      this.install(database);
    } catch (primary) {
      this.#terminal = true;
      if (database.isInitialized) {
        try {
          await database.destroy();
        } catch (cleanup) {
          throw new PrivateNativeStockPoolFailure(primary, [cleanup]);
        }
      }
      throw primary;
    } finally {
      this.#initializing.delete(database);
    }
  }

  async close(database: DataSource): Promise<void> {
    this.#terminal = true;
    if (!this.#owned.has(database) || this.#initializing.size)
      throw new PrivateNativeActionUnavailable();
    if (!this.#withdrawn.has(database)) {
      this.control.withdrawBusinessDatabase(database, this.checkpoint);
      this.#withdrawn.add(database);
    }
    if (database.isInitialized) await database.destroy();
    this.#owned.delete(database);
    this.#withdrawn.delete(database);
  }

  async closeAll(): Promise<void> {
    this.#terminal = true;
    const errors: unknown[] = [];
    for (const database of [...this.#owned].reverse()) {
      try {
        await this.close(database);
      } catch (error) {
        errors.push(error);
      }
    }
    errors.push(...this.#fenceFailures);
    if (errors.length)
      throw new PrivateNativeStockPoolFailure(errors[0], errors.slice(1));
  }
}

export class PrivateNativeStockPoolFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private stock pools require closure reconciliation');
  }
}
