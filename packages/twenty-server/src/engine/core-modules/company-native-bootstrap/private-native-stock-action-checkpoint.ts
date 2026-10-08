import { type DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import {
  readStockPendingNativePlan,
  type StockPendingNativePlan,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pending-plan';

const issuedCheckpoints = new WeakSet<PrivateNativeStockActionCheckpoint>();

// This is current-action evidence, not a setup credential or SQL capability.
// Stock status transitions cannot reuse the old PENDING-only row selector.
export class PrivateNativeStockActionCheckpoint {
  private constructor(
    private readonly originalFence: PrivateNativeMutationFence,
    private readonly nativeDatabase: DataSource,
    readonly pendingPlan: StockPendingNativePlan,
  ) {}

  static async bindPending(
    originalFence: PrivateNativeMutationFence,
    nativeDatabase: DataSource,
  ): Promise<PrivateNativeStockActionCheckpoint> {
    const pendingPlan = await readStockPendingNativePlan(
      originalFence,
      nativeDatabase,
    );
    await originalFence.assertCurrent();
    const checkpoint = new PrivateNativeStockActionCheckpoint(
      originalFence,
      nativeDatabase,
      pendingPlan,
    );
    issuedCheckpoints.add(checkpoint);
    Object.freeze(checkpoint);
    return checkpoint;
  }

  static assertIssued(checkpoint: PrivateNativeStockActionCheckpoint): void {
    if (!issuedCheckpoints.has(checkpoint))
      throw new PrivateNativeActionUnavailable();
  }

  async assertOriginalCustomPackageMetadata(): Promise<void> {
    await this.assertNativeDatabase(this.nativeDatabase);
    const original = this.pendingPlan.original;
    const rows: unknown = await this.nativeDatabase.query(
      `SELECT a.id AS application_id,
      a."packageJsonChecksum" AS package_checksum,a."yarnLockChecksum" AS yarn_checksum,
      f.id AS file_id,f.path,f.size,f."mimeType" AS mime
      FROM core.application a JOIN core.file f ON f."applicationId"=a.id
      WHERE a.id=$1::uuid AND a."workspaceId"=$2::uuid AND a."universalIdentifier"=a.id
        AND a."deletedAt" IS NULL AND f."workspaceId"=a."workspaceId" AND f."deletedAt" IS NULL
        AND ((f.id=a."packageJsonFileId" AND f.path='dependencies/package.json')
          OR (f.id=a."yarnLockFileId" AND f.path='dependencies/yarn.lock'))
        AND (SELECT count(*) FROM core.file all_files
          WHERE all_files."applicationId"=a.id AND all_files."deletedAt" IS NULL)=2`,
      [original.customApplicationId, original.workspaceId],
    );
    await this.assertCurrent();
    if (
      !Array.isArray(rows) ||
      rows.length !== 2 ||
      new Set(rows.map((row) => row.file_id)).size !== 2 ||
      rows.some(
        (row) =>
          Object.keys(row).length !== 7 ||
          row.application_id !== original.customApplicationId ||
          row.package_checksum !== 'cbe15a5c1c73b15f40d168ee46ce845d' ||
          row.yarn_checksum !== 'fefb6d70e11253c793bf94197d615b45' ||
          row.mime !== 'application/octet-stream',
      ) ||
      rows.filter(
        (row) => row.path === 'dependencies/package.json' && row.size === 1387,
      ).length !== 1 ||
      rows.filter(
        (row) => row.path === 'dependencies/yarn.lock' && row.size === 112283,
      ).length !== 1
    )
      throw new PrivateNativeActionUnavailable();
  }

  remainingOriginalWorkMilliseconds(): number {
    PrivateNativeStockActionCheckpoint.assertIssued(this);
    return this.originalFence.remainingOriginalWorkMilliseconds();
  }

  async assertCurrent(): Promise<void> {
    PrivateNativeStockActionCheckpoint.assertIssued(this);
    // Retains both the original Core lease/action checks and old-role catalog
    // ceilings. No new clock, remaining-life parameter or native status bypass.
    await this.originalFence.assertCurrent();
  }

  async assertNativeDatabase(database: DataSource): Promise<void> {
    await this.assertCurrent();
    if (database !== this.nativeDatabase)
      throw new PrivateNativeActionUnavailable();
    await this.originalFence.assertOriginalNativeDatabase(database);
    await this.assertCurrent();
  }

  async assertNativeEndpoint(database: DataSource): Promise<void> {
    await this.assertCurrent();
    await this.originalFence.assertOriginalNativeDatabase(database);
    await this.assertCurrent();
  }
}
