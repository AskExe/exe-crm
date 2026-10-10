import { Socket } from 'node:net';
import { Client } from 'pg';
import { type PrivatePeopleDeadline } from './private-people-contract';
import { nativeEditorActivationUnavailable as unavailable } from './private-native-editor-activation-errors';
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => Error;

export abstract class PrivateNativeEditorActivationOperationOwner {
  protected pending?: Promise<unknown>;
  protected pendingSettled = true;
  protected operationFailed = false;
  protected operationError: unknown;
  protected readonly operationSecondary: unknown[] = [];
  protected cancellation?: Promise<void>;
  protected cancellationFailed = false;
  protected cancellationSettled = true;
  protected cancellationError: unknown;
  protected control?: Client;
  protected controlClosed = false;
  protected controlSocket?: Socket;
  protected pendingKind: 'sql' | 'release' | 'control-close' = 'sql';
  protected backend?: Readonly<{
    pid: number;
    start: string;
    database: string;
    user: string;
  }>;
  protected abstract disposing: boolean;
  protected abstract current(): number;
  protected own<T>(operation: () => Promise<T>, cleanup = false): Promise<T> {
    if (!cleanup) this.current();
    if (
      !this.pendingSettled ||
      !this.cancellationSettled ||
      (!cleanup && this.disposing)
    )
      throw unavailable();
    this.pendingSettled = false;
    if (!cleanup) this.pendingKind = 'sql';
    this.cancellation = undefined;
    const pending = Promise.resolve().then(operation);
    this.pending = pending;
    // Keep the original rejection observed, including thrown falsy values.
    void pending.then(
      () => {
        this.pendingSettled = true;
      },
      (error: unknown) => {
        this.pendingSettled = true;
        if (this.operationFailed) this.operationSecondary.push(error);
        else {
          this.operationFailed = true;
          this.operationError = error;
        }
      },
    );
    return pending;
  }

  protected requestCancellation(): void {
    if (this.pendingSettled) return;
    if (this.pendingKind === 'control-close') {
      // Only the socket created by this credential's fixed control Client.
      // Destroying it is connection closure, never a foreign backend signal.
      this.controlSocket?.destroy();
      return;
    }
    if (
      this.pendingKind !== 'sql' ||
      !this.control ||
      !this.backend ||
      this.cancellation
    )
      return;
    const control = this.control;
    const backend = this.backend;
    this.cancellationSettled = false;
    this.cancellation = (async () => {
      const result = await control.query(
        `SELECT pg_cancel_backend(a.pid) AS cancelled FROM pg_stat_activity a
         WHERE a.pid=$1 AND a.backend_start=$2::timestamptz
           AND a.datname=$3 AND a.usename=$4 AND a.usename=current_user
           AND a.datname=current_database() AND a.pid<>pg_backend_pid()`,
        [backend.pid, backend.start, backend.database, backend.user],
      );
      if (result.rows.length !== 1 || result.rows[0].cancelled !== true)
        throw unavailable();
    })();
    void this.cancellation.then(
      () => {
        this.cancellationSettled = true;
      },
      (error: unknown) => {
        this.cancellationSettled = true;
        this.cancellationFailed = true;
        this.cancellationError = error;
      },
    );
  }

  protected async settled(end: PrivatePeopleDeadline): Promise<void> {
    end.remaining();
    if (!this.pending) return;
    if (!this.pendingSettled) this.requestCancellation();
    let onAbort: () => void = () => {};
    try {
      await Promise.race([
        (async () => {
          await this.pending?.then(
            () => {},
            () => {},
          );
          // A prior cancel reply must settle before a cleanup SQL operation;
          // otherwise its delivery could race that next statement.
          await this.cancellation?.then(
            () => {},
            () => {},
          );
        })(),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(unavailable());
          end.signal.addEventListener('abort', onAbort, { once: true });
          if (end.signal.aborted) onAbort();
        }),
      ]);
      end.remaining();
      if (!this.pendingSettled || !this.cancellationSettled)
        throw unavailable();
    } finally {
      end.signal.removeEventListener('abort', onAbort);
    }
  }

  protected async cleanupOperation(
    operation: () => Promise<void>,
    end: PrivatePeopleDeadline,
    kind: 'sql' | 'release' | 'control-close',
  ): Promise<void> {
    end.remaining();
    if (!this.pendingSettled || !this.cancellationSettled) throw unavailable();
    this.pendingKind = kind;
    let onAbort: () => void = () => {};
    const pending = this.own(async () => {
      end.remaining();
      await operation();
      end.remaining();
    }, true);
    try {
      await Promise.race([
        (async () => {
          let failed = false;
          let primary: unknown;
          try {
            await pending;
          } catch (error) {
            failed = true;
            primary = error;
          }
          try {
            await this.cancellation;
          } catch (error) {
            if (failed)
              throw new AggregateError(
                [primary, error],
                'Native cleanup cancellation unavailable',
              );
            throw error;
          }
          if (failed) throw primary;
        })(),
        new Promise<never>((_, reject) => {
          onAbort = () => {
            this.requestCancellation();
            reject(unavailable());
          };
          end.signal.addEventListener('abort', onAbort, { once: true });
          if (end.signal.aborted) onAbort();
        }),
      ]);
    } finally {
      end.signal.removeEventListener('abort', onAbort);
    }
  }
}
