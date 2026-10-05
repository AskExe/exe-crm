import { performance } from 'node:perf_hooks';
import { type Readable } from 'node:stream';

import {
  snapshotPrivateNativeActionTuple,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
} from './private-native-action-reader';

export type PrivateFirstWriterFrame = Readonly<{
  version: 'core-first-writer-v1';
  tuple: PrivateNativeActionTuple;
  initial_sql_time: string;
  original_lease_expires_at: string;
  remaining_work_milliseconds: number;
}>;

function refuse(ok: unknown): asserts ok {
  if (!ok) throw new PrivateNativeActionUnavailable();
}

// JSON is not dispatch authentication. Only the exact private receiver in the
// parent-created/bound container may consume this one original-success pipe.
export function parsePrivateFirstWriterFrame(
  value: unknown,
): PrivateFirstWriterFrame {
  refuse(
    value !== null &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  const keys = [
    'version',
    'tuple',
    'initial_sql_time',
    'original_lease_expires_at',
    'remaining_work_milliseconds',
  ];
  refuse(Reflect.ownKeys(value).length === keys.length);
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    refuse(d && d.enumerable && 'value' in d);
    fields[key] = d.value;
  }
  refuse(fields.version === 'core-first-writer-v1');
  for (const key of ['initial_sql_time', 'original_lease_expires_at']) {
    refuse(
      typeof fields[key] === 'string' &&
        (fields[key] as string).length <= 40 &&
        Number.isFinite(Date.parse(fields[key] as string)),
    );
  }
  const duration =
    Date.parse(fields.original_lease_expires_at as string) -
    Date.parse(fields.initial_sql_time as string);
  refuse(
    duration > 0 &&
      duration <= 300000 &&
      Number.isSafeInteger(fields.remaining_work_milliseconds) &&
      (fields.remaining_work_milliseconds as number) > 0 &&
      (fields.remaining_work_milliseconds as number) <= 210000,
  );
  return Object.freeze({
    ...fields,
    tuple: snapshotPrivateNativeActionTuple(fields.tuple),
  }) as PrivateFirstWriterFrame;
}

export async function readPrivateFirstWriterFrame(
  stream: Readable,
): Promise<PrivateFirstWriterFrame> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new PrivateNativeActionUnavailable()),
      5000,
    );
    let complete = false;
    function finish(error?: unknown) {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      stream.off('data', data);
      stream.off('end', end);
      stream.off('error', failure);
      stream.off('close', closed);
      if (error) {
        stream.pause();
        reject(error);
      } else resolve(Buffer.concat(chunks));
    }
    function data(chunk: Buffer | string) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.length;
      if (bytes > 16384) finish(new PrivateNativeActionUnavailable());
      else chunks.push(part);
    }
    function end() {
      finish();
    }
    function failure(error: unknown) {
      finish(error);
    }
    function closed() {
      finish(new PrivateNativeActionUnavailable());
    }
    stream.on('data', data);
    stream.once('end', end);
    stream.once('error', failure);
    stream.once('close', closed);
  });
  // Exact one JSON line and actual EOF. No file/resume entry or second frame.
  const text = raw.toString('utf8');
  refuse(
    raw.length > 0 &&
      text.endsWith('\n') &&
      !text.slice(0, -1).includes('\n') &&
      Buffer.from(text).equals(raw),
  );
  const value: unknown = JSON.parse(text.slice(0, -1));
  // Parent emits JSON.stringify bytes. Reject duplicate keys/alternate carriers
  // before closed snapshot; JSON.parse alone would silently erase duplicates.
  refuse(JSON.stringify(value) + '\n' === text);
  return parsePrivateFirstWriterFrame(value);
}

/** SQL clock domain bounds dispatch latency; local monotonic origins are never
 * transported. The initial work end can only shorten after its first read. */
export class PrivateDispatchLifetime {
  private admittedEnd: number | null = null;
  private latestSql: number;
  private earliestExpiry: number;
  constructor(
    private readonly frame: PrivateFirstWriterFrame,
    private readonly localEnd: number,
  ) {
    this.latestSql = Date.parse(frame.initial_sql_time);
    this.earliestExpiry = Date.parse(frame.original_lease_expires_at);
  }
  limit(
    sqlTime: number,
    sqlExpiry: number,
    before: number,
    after: number,
    required: number,
  ): number {
    refuse(
      Number.isFinite(before) &&
        after >= before &&
        sqlTime >= this.latestSql &&
        after < this.localEnd,
    );
    this.latestSql = sqlTime;
    if (this.admittedEnd === null) {
      const transit = sqlTime - Date.parse(this.frame.initial_sql_time);
      const work =
        this.frame.remaining_work_milliseconds - transit - (after - before) - 2;
      refuse(work > 0);
      this.admittedEnd = Math.min(this.localEnd, after + work);
    }
    this.earliestExpiry = Math.min(this.earliestExpiry, sqlExpiry);
    const expiry = this.earliestExpiry;
    const leaseEnd = after + expiry - sqlTime - (after - before) - 2;
    refuse(this.admittedEnd > after && leaseEnd > after + required);
    return leaseEnd;
  }
  workEnd(): number {
    refuse(this.admittedEnd !== null && performance.now() < this.admittedEnd);
    return this.admittedEnd;
  }
}
