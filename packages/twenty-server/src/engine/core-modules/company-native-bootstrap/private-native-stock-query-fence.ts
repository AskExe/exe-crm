import { type DataSource, type QueryRunner } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';

import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';

// Currentness only: this does not issue or admit a stock database credential.
// The isolated provider assembly must separately admit its exact role/ACLs.
export async function fencePrivateStockQueryRunner(
  database: DataSource,
  runner: QueryRunner,
  checkpoint: PrivateNativeStockActionCheckpoint,
  stockControl?: PrivateNativeStockRoleGuard,
): Promise<void> {
  const originalQuery = runner.query;
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  if (stockControl)
    await stockControl.assertBusinessDatabase(database, checkpoint);
  else await checkpoint.assertNativeEndpoint(database);
  if (
    runner.connection !== database ||
    runner.isTransactionActive ||
    runner.isReleased
  ) {
    throw new PrivateNativeActionUnavailable();
  }

  const originalRollback = runner.rollbackTransaction;
  const originalRelease = runner.release;
  let terminal = false;
  let rollingBack = false;
  let released = false;
  let queryInFlight = false;
  const guarded: QueryRunner['query'] = async (
    ...args: [
      query: string,
      parameters?: unknown[],
      useStructuredResult?: boolean,
    ]
  ) => {
    if (released || queryInFlight || runner.query !== guarded) {
      throw new PrivateNativeActionUnavailable();
    }
    const rollback =
      rollingBack &&
      (args[0] === 'ROLLBACK' ||
        /^ROLLBACK TO SAVEPOINT typeorm_[0-9]+$/.test(args[0])) &&
      args.length === 1;
    if (terminal && !rollback) throw new PrivateNativeActionUnavailable();
    queryInFlight = true;
    try {
      if (!rollback) {
        if (stockControl)
          await stockControl.assertBusinessDatabase(database, checkpoint);
        else await checkpoint.assertCurrent();
      }
      if (!rollback && stockControl) {
        // Use this exact held business runner, not DataSource.query: endpoint
        // drift/SET ROLE cannot turn a previously bound pool into authority.
        const endpoint: unknown = await Reflect.apply(originalQuery, runner, [
          `SELECT inet_server_addr()::text AS address,inet_server_port() AS port,
           current_database() AS database,session_user::text AS session,current_user::text AS actor`,
        ]);
        stockControl.assertBusinessProjection(database, endpoint);
        await stockControl.assertBusinessDatabase(database, checkpoint);
      }
      const result = await Reflect.apply(originalQuery, runner, args);
      if (!rollback) {
        if (stockControl)
          await stockControl.assertBusinessDatabase(database, checkpoint);
        else await checkpoint.assertCurrent();
      }
      return result;
    } catch (error) {
      terminal = true;
      throw error;
    } finally {
      queryInFlight = false;
    }
  };
  runner.query = guarded;
  runner.rollbackTransaction = async () => {
    if (released || rollingBack || queryInFlight) {
      throw new PrivateNativeActionUnavailable();
    }
    // Revocation cannot authorize arbitrary SQL during terminal cleanup.
    terminal = true;
    rollingBack = true;
    try {
      return await Reflect.apply(originalRollback, runner, []);
    } finally {
      rollingBack = false;
    }
  };
  runner.release = async () => {
    if (released || rollingBack || queryInFlight) {
      throw new PrivateNativeActionUnavailable();
    }
    terminal = true;
    try {
      return await Reflect.apply(originalRelease, runner, []);
    } finally {
      released = true;
      // Keep the closed query fence installed: a retained runner reference can
      // never become an unfenced SQL path, even if release itself failed.
    }
  };
}
