import { type INestApplicationContext } from '@nestjs/common';

import { type DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import {
  PrivateNativeStockParentLifecycle,
  type PrivateStockNativeObservation,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-parent-lifecycle';
import { PrivateNativeStockPoolCustody } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pool-custody';
import { createPrivateStockProviderContext } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-provider-context';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { PrivateNativeStockSdkChannel } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-channel';
import { createPrivateStockSetupIdentity } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-identity';
import { PrivateNativeStockStorage } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage';
import { completeOriginalStockSubjectAndRemoveSetup } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-subject-completion';
import { activateOriginalStockWorkspace } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-workspace-operation';

import { PrivateNativeStockOutputObserver } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-output-observer';

export type PrivateStockSetupObservation = Readonly<{
  native: PrivateStockNativeObservation;
  files: Awaited<ReturnType<PrivateNativeStockOutputObserver['observe']>>;
}>;

const issued = new WeakSet<PrivateNativeStockSetupSession>();

// Unmounted concrete composition, not a provider/plugin selector. A complete SQL
// observation is still not filesystem qualification, final identity activation,
// Core readiness or an accepted native receipt.
export class PrivateNativeStockSetupSession {
  #business: DataSource | undefined;
  #control: PrivateNativeStockRoleGuard | undefined;
  #custody: PrivateNativeStockPoolCustody | undefined;
  #storage: PrivateNativeStockStorage | undefined;
  #channel: PrivateNativeStockSdkChannel | undefined;
  #context: INestApplicationContext | undefined;
  #started = false;
  #closed = false;
  #beginAttempted = false;

  private constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
    private readonly parent: PrivateNativeStockParentLifecycle,
    private readonly original: DataSource,
  ) {}

  static async bind(
    checkpoint: PrivateNativeStockActionCheckpoint,
    original: DataSource,
    parent: DataSource,
  ): Promise<PrivateNativeStockSetupSession> {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    await checkpoint.assertNativeDatabase(original);
    const lifecycle = await PrivateNativeStockParentLifecycle.bind(
      checkpoint,
      parent,
      original,
    );
    lifecycle.assertCheckpoint(checkpoint);
    const session = new PrivateNativeStockSetupSession(
      checkpoint,
      lifecycle,
      original,
    );
    issued.add(session);
    return session;
  }

  async prepare(): Promise<PrivateStockSetupObservation> {
    if (!issued.has(this) || this.#started || this.#closed)
      throw new PrivateNativeActionUnavailable();
    this.#started = true;
    let primary: unknown;
    let failed = false;
    let completed = false;
    let outputObserver: PrivateNativeStockOutputObserver | undefined;
    const cleanupErrors: unknown[] = [];
    try {
      await this.checkpoint.assertCurrent();
      this.#control = await PrivateNativeStockRoleGuard.bindControl(
        this.original,
        this.checkpoint,
      );
      this.#beginAttempted = true;
      this.#business = await this.parent.begin();
      await this.#control.bindBusinessDatabase(this.#business);
      // The explicit setup runner is admitted before automatic pool fencing.
      // Installing custody first would wrap a gate as its own original query.
      await createPrivateStockSetupIdentity(
        this.checkpoint,
        this.#business,
        this.#control,
      );
      this.#custody = await PrivateNativeStockPoolCustody.bind(
        this.#business,
        this.#control,
        this.checkpoint,
      );
      this.#storage = await PrivateNativeStockStorage.bind(this.checkpoint);
      this.#channel = await PrivateNativeStockSdkChannel.bind(this.checkpoint);
      this.#context = await createPrivateStockProviderContext(
        this.checkpoint,
        this.#business,
        this.#control,
        this.#custody,
        this.#storage,
        this.#channel,
      );
      await activateOriginalStockWorkspace(
        this.checkpoint,
        this.#business,
        this.#control,
        this.#context,
      );
      await completeOriginalStockSubjectAndRemoveSetup(
        this.checkpoint,
        this.#business,
        this.#control,
        this.#context,
      );
      await this.checkpoint.assertCurrent();
      outputObserver = PrivateNativeStockOutputObserver.bind(
        this.checkpoint,
        this.#storage,
      );
      completed = true;
    } catch (error) {
      failed = true;
      primary = error;
    } finally {
      // Every acquired owner is attempted independently; no cleanup error may
      // replace the first operation failure or skip remaining owned closure.
      if (this.#context) {
        try {
          await this.#context.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (this.#custody) {
        try {
          await this.#custody.closeAll();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        await this.parent.closeBusiness();
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (this.#channel) {
        try {
          await this.#channel.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (this.#storage) {
        try {
          await this.#storage.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (this.#beginAttempted) {
        try {
          await this.parent.disable();
        } catch (error) {
          cleanupErrors.push(error);
        }
        // A partial stock state stays disabled/quarantined. WITHDRAW requires
        // supported setup removal and exact schema ownership, never DROP OWNED.
        if (completed) {
          try {
            await this.parent.withdraw();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
      }
      this.#closed = true;
    }
    if (failed || cleanupErrors.length)
      throw new PrivateNativeStockSessionUncertain(
        failed ? primary : new PrivateNativeActionUnavailable(),
        Object.freeze(cleanupErrors),
      );
    // No replacement timer: the current original action must still qualify.
    const native = await this.parent.observe();
    if (!outputObserver) throw new PrivateNativeActionUnavailable();
    const files = await outputObserver.observe();
    return Object.freeze({ native, files });
  }
}

export class PrivateNativeStockSessionUncertain extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private stock setup requires reconciliation');
  }
}
