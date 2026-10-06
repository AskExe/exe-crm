import { type DataSource } from 'typeorm';

import { type PrivatePeopleCurrentPair } from './private-people-role-binding';

import { type PrivatePeopleDeadline } from './private-people-contract';
import { privatePeoplePoolBounds } from './private-people-pool-options';
import { type PrivatePeoplePoolCustody } from './private-people-io-custody';
import { peopleMonotonicNow } from './private-people-protocol';
import { type PrivatePeopleWorkerResources } from './private-people-worker-package';

export interface PrivatePeopleAssemblyLifecycle {
  prepare(
    work: PrivatePeopleDeadline,
    currentPair: PrivatePeopleCurrentPair,
  ): Promise<PrivatePeopleWorkerResources>;
  disposeIO(cleanup: PrivatePeopleDeadline): Promise<void>;
  finalize(cleanup: PrivatePeopleDeadline): Promise<void>;
  abort(reason: unknown): void;
  refuse(reason: unknown, secondary?: readonly unknown[]): Promise<void>;
}
export type PrivatePeopleAssemblyFactory = {
  version: 1;
  createOwnedLifecycle(): PrivatePeopleAssemblyLifecycle;
};

export class PrivatePeopleAssemblySettlement extends Error {
  constructor(
    readonly primary: unknown,
    readonly secondary: readonly unknown[],
  ) {
    super('Private assembly settlement unproved');
  }
}

type OwnedIO = {
  acquisition: Promise<unknown>;
  close: () => Promise<void>;
  closing?: Promise<void>;
};

// Each concrete resource is retained BEFORE its acquisition is invoked. Pending
// operations are never raced away and forgotten; disposal awaits their settlement.
export class PrivatePeopleIOCustody implements PrivatePeoplePoolCustody {
  private readonly resources = new Map<object, OwnedIO>();
  private end = Infinity;
  private fatal: unknown;
  private closing = false;
  private disposal?: Promise<void>;

  admit(deadline: PrivatePeopleDeadline) {
    this.end = Math.min(this.end, peopleMonotonicNow() + deadline.remaining());
    deadline.signal.addEventListener(
      'abort',
      () => this.abort(new Error('Private assembly aborted')),
      { once: true },
    );
    this.assertCurrent();
  }
  abort(reason: unknown) {
    if (this.fatal === undefined) this.fatal = reason;
  }
  primaryFailure(fallback: unknown) {
    return this.fatal === undefined ? fallback : this.fatal;
  }
  assertCurrent() {
    if (this.fatal !== undefined) throw this.fatal;
    if (peopleMonotonicNow() >= this.end)
      throw new Error('Private assembly original end');
  }
  assertClosureTime() {
    // Fatal refuses success but does not erase custody of known resources.
    if (peopleMonotonicNow() >= this.end)
      throw new Error('Private assembly closure unproved');
  }
  async checked<T>(promise: Promise<T>): Promise<T> {
    this.assertCurrent();
    const value = await promise;
    this.assertCurrent();
    if (this.closing) throw new Error('Private assembly closing');
    return value;
  }
  own<T>(
    identity: object,
    acquire: () => Promise<T>,
    close: () => Promise<void>,
  ): Promise<T> {
    this.assertCurrent();
    if (this.closing || this.resources.has(identity))
      throw new Error('Private assembly resource reuse');
    const row: OwnedIO = { acquisition: Promise.resolve(), close };
    this.resources.set(identity, row);
    // Promise.resolve().then postpones acquisition until after row is in custody.
    const acquisition = Promise.resolve().then(() => {
      this.assertCurrent();
      if (this.closing) throw new Error('Private assembly closing');
      return acquire();
    });
    row.acquisition = acquisition;
    return this.checked(acquisition).catch((error: unknown) => {
      this.abort(error);
      throw error;
    });
  }
  initialize(source: DataSource): Promise<DataSource> {
    source.setOptions(privatePeoplePoolBounds(source.options));
    return this.own(
      source,
      () => source.initialize(),
      async () => {
        if (source.isInitialized) await source.destroy();
      },
    );
  }
  close(identity: object): Promise<void> {
    this.assertClosureTime();
    const row = this.resources.get(identity);
    if (!row)
      return Promise.reject(new Error('Private assembly unknown resource'));
    if (!row.closing)
      row.closing = (async () => {
        this.assertClosureTime();
        // Rejected initialization is settled, not forgotten. Successful late
        // acquisition is closed only inside the original ceiling, otherwise fail-stop.
        await Promise.allSettled([row.acquisition]);
        this.assertClosureTime();
        await row.close();
        this.assertClosureTime();
      })();
    return row.closing;
  }
  limitClosure(cleanup: PrivatePeopleDeadline) {
    this.end = Math.min(this.end, peopleMonotonicNow() + cleanup.remaining());
    this.assertClosureTime();
  }
  dispose(cleanup: PrivatePeopleDeadline): Promise<void> {
    // Cleanup may only shorten the first protected admission. No renewed end.
    this.limitClosure(cleanup);
    return this.settleKnownIO();
  }
  settleKnownIO(): Promise<void> {
    // Refusal uses only the existing admission, never a fresh deadline.
    this.assertClosureTime();
    this.closing = true;
    if (!this.disposal)
      this.disposal = (async () => {
        const settled = await Promise.allSettled(
          [...this.resources.keys()].map((resource) => this.close(resource)),
        );
        this.assertClosureTime();
        const failures = settled.filter(
          (row): row is PromiseRejectedResult => row.status === 'rejected',
        );
        if (failures.length)
          throw new PrivatePeopleAssemblySettlement(
            this.fatal === undefined ? failures[0].reason : this.fatal,
            failures.map((row) => row.reason),
          );
        if (this.fatal !== undefined) throw this.fatal;
      })();
    return this.disposal;
  }
}

type OwnedContext = { close(): Promise<void> };
type OwnedListeners = { removeAllListeners(): unknown };
// Internal context/listener custody; concrete factory supplies only its actual
// retained Nest promise and emitter. No provider/module/config selector.
export class PrivatePeopleContextCustody {
  private pending?: Promise<OwnedContext>;
  private listeners?: OwnedListeners;
  private closing?: Promise<void>;
  constructor(private readonly io: PrivatePeopleIOCustody) {}
  retain(pending: Promise<OwnedContext>) {
    if (this.pending || this.closing)
      throw new Error('Private assembly context reuse');
    this.pending = pending;
  }
  retainListeners(listeners: OwnedListeners) {
    if (this.listeners || this.closing)
      throw new Error('Private assembly listener reuse');
    this.listeners = listeners;
  }
  close(): Promise<void> {
    this.io.assertClosureTime();
    if (!this.closing)
      this.closing = (async () => {
        let first: unknown;
        let failed = false;
        const secondary: unknown[] = [];
        try {
          if (this.pending) {
            const settled = await Promise.allSettled([this.pending]);
            this.io.assertClosureTime();
            if (settled[0].status === 'fulfilled') {
              await settled[0].value.close();
              this.io.assertClosureTime();
            } else throw settled[0].reason;
          }
        } catch (error) {
          failed = true;
          first = error;
        }
        try {
          this.listeners?.removeAllListeners();
        } catch (error) {
          if (failed) secondary.push(error);
          else {
            failed = true;
            first = error;
          }
        }
        try {
          this.io.assertClosureTime();
        } catch (error) {
          if (failed) secondary.push(error);
          else {
            failed = true;
            first = error;
          }
        }
        if (failed) {
          if (secondary.length)
            throw new PrivatePeopleAssemblySettlement(first, secondary);
          throw first;
        }
      })();
    return this.closing;
  }
}
