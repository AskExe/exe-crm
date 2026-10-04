import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

import { ServiceUnavailableException } from '@nestjs/common';
import { type DataSource, type QueryRunner } from 'typeorm';

import {
  companyAuthEnabled,
  COMPANY_UUID,
} from '../company-auth/company-auth.config';

import { companyMcpEnabled } from './company-mcp.config';
import { type CompanyRead } from './company-mcp.protocol';

export const COMPANY_READ_CONTROL_MAX_MS = 9000;

const MAX_STATEMENT_MS = 3000;
const CLEANUP_GRACE_MS = 5000;
const controls = new AsyncLocalStorage<CompanyReadControl>();

type CompanyReadControl = {
  signal: AbortSignal;
  monotonicDeadline: number;
  absoluteDeadline: number;
  read: CompanyRead;
  fatal: () => never;
};

export type CompanyReadLease = {
  runner: QueryRunner;
  terminal: <T>(operation: () => Promise<T>) => Promise<T>;
};

const unavailable = () =>
  new ServiceUnavailableException('Company read unavailable');

// Fixed own-process policy: never return an uncertain native connection to a pool.
const fatal = (): never => {
  process.stderr.write('Company native read teardown failed\n');
  process.exit(1);
};

export const withCompanyReadControl = async <T>(
  control: Omit<CompanyReadControl, 'fatal'>,
  operation: () => Promise<T>,
  testFatal?: () => never,
): Promise<T> => {
  if (!companyMcpEnabled() || (testFatal && process.env.NODE_ENV !== 'test'))
    throw unavailable();
  return runCapturedControl(control, operation, testFatal ?? fatal);
};

// REST uses the same native lease while MCP remains independently default-off.
export const withCompanyRestReadControl = async <Result>(
  control: Omit<CompanyReadControl, 'fatal'>,
  operation: () => Promise<Result>,
): Promise<Result> => {
  if (!companyAuthEnabled()) throw unavailable();
  return runCapturedControl(control, operation, fatal);
};

const runCapturedControl = <Result>(
  control: Omit<CompanyReadControl, 'fatal'>,
  operation: () => Promise<Result>,
  fatalPolicy: () => never,
): Promise<Result> => {
  const descriptors = Object.getOwnPropertyDescriptors(control);
  if (
    Object.getPrototypeOf(control) !== Object.prototype ||
    Reflect.ownKeys(control).length !== 4 ||
    ['signal', 'monotonicDeadline', 'absoluteDeadline', 'read'].some(
      (key) => !descriptors[key] || !('value' in descriptors[key]),
    )
  )
    throw unavailable();
  const signal: unknown = descriptors.signal.value;
  const monotonicDeadline: unknown = descriptors.monotonicDeadline.value;
  const absoluteDeadline: unknown = descriptors.absoluteDeadline.value;
  const read: unknown = descriptors.read.value;
  if (
    !(signal instanceof AbortSignal) ||
    typeof monotonicDeadline !== 'number' ||
    !Number.isFinite(monotonicDeadline) ||
    typeof absoluteDeadline !== 'number' ||
    !Number.isFinite(absoluteDeadline) ||
    monotonicDeadline - performance.now() > COMPANY_READ_CONTROL_MAX_MS ||
    absoluteDeadline - Date.now() > COMPANY_READ_CONTROL_MAX_MS ||
    !read ||
    typeof read !== 'object' ||
    Object.getPrototypeOf(read) !== Object.prototype
  )
    throw unavailable();
  const fields = Object.getOwnPropertyDescriptors(read);
  if (
    Reflect.ownKeys(read).some(
      (key) =>
        typeof key !== 'string' || !['object', 'id', 'limit'].includes(key),
    ) ||
    Object.values(fields).some((field) => !('value' in field)) ||
    !['people', 'companies'].includes(fields.object?.value) ||
    !Number.isSafeInteger(fields.limit?.value) ||
    fields.limit.value < 1 ||
    fields.limit.value > 100 ||
    (fields.id?.value !== undefined &&
      (typeof fields.id.value !== 'string' ||
        !COMPANY_UUID.test(fields.id.value)))
  )
    throw unavailable();
  const captured = Object.freeze({
    signal,
    monotonicDeadline,
    absoluteDeadline,
    read: Object.freeze({
      object: fields.object.value,
      id: fields.id?.value,
      limit: fields.limit.value,
    }),
    fatal: fatalPolicy,
  });
  remaining(captured);
  return controls.run(captured, operation);
};

export const assertCompanyRowPredicateFlag = (enabled: unknown): void => {
  if (controls.getStore() && enabled !== true) throw unavailable();
};

const remaining = (control: CompanyReadControl): number => {
  const milliseconds = Math.floor(
    Math.min(
      control.monotonicDeadline - performance.now(),
      control.absoluteDeadline - Date.now(),
    ),
  );
  if (
    Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      'aborted',
    )!.get!.call(control.signal) ||
    milliseconds < 1
  )
    throw unavailable();
  return Math.min(MAX_STATEMENT_MS, milliseconds);
};

// Called only by the native FindOne/Many read sections, after RestBase authority.
// The runner is created here, never supplied by an HTTP caller or ALS control.
export const withCompanyReadLease = async <T>(
  dataSource: Pick<DataSource, 'createQueryRunner'>,
  operation: (lease?: CompanyReadLease) => Promise<T>,
): Promise<T> => {
  const control = controls.getStore();
  if (!control) return operation(); // Ordinary reads preserve existing behavior.
  remaining(control); // No allocation/connect after cancellation/deadline.
  const runner = dataSource.createQueryRunner('master');
  const watchdog = setTimeout(
    control.fatal,
    Math.max(
      1,
      Math.min(
        control.monotonicDeadline - performance.now(),
        control.absoluteDeadline - Date.now(),
      ),
    ) + CLEANUP_GRACE_MS,
  );
  // No unref: a pending teardown must not silently disappear on process shutdown.
  let connected = false;
  let began = false;
  let beginAttempted = false;
  let cleaned = false;
  try {
    await runner.connect();
    connected = true;
    remaining(control);
    beginAttempted = true;
    await runner.startTransaction();
    began = true;
    await runner.query('SET TRANSACTION READ ONLY');
    const terminal = async <R>(query: () => Promise<R>): Promise<R> => {
      const milliseconds = remaining(control);
      await runner.query("SELECT set_config('statement_timeout', $1, true)", [
        String(milliseconds),
      ]);
      remaining(control);
      // Await real terminal query. Abort does not cancel SQL; PostgreSQL timeout does.
      const value = await query();
      remaining(control);
      return value;
    };
    const value = await operation({ runner, terminal });
    remaining(control);
    return value;
  } finally {
    if (!connected || (beginAttempted && !began)) {
      // Failed connect/BEGIN can have uncertain server state: no pool release.
      control.fatal();
    }
    try {
      if (began) await runner.rollbackTransaction();
      await runner.release();
      cleaned = true;
    } catch {
      control.fatal();
    } finally {
      if (cleaned) clearTimeout(watchdog);
    }
  }
};

// Validate the closed native dispatch before allocating the lease. This checks
// server-created parser output too, so a future dispatch drift cannot widen it.
export const assertCompanyReadShape = (
  kind: 'one' | 'many',
  objectName: string,
  args: {
    filter?: unknown;
    orderBy?: unknown;
    first?: unknown;
    last?: unknown;
    before?: unknown;
    after?: unknown;
    offset?: unknown;
    selectedFieldsResult: { relations?: unknown; aggregate?: unknown };
  },
): void => {
  const control = controls.getStore();
  if (!control) return;
  remaining(control);
  const read = control.read;
  const relations = args.selectedFieldsResult.relations ?? {};
  const aggregate = args.selectedFieldsResult.aggregate ?? {};
  if (
    objectName !== read.object ||
    !relations ||
    typeof relations !== 'object' ||
    Object.keys(relations).length ||
    !aggregate ||
    typeof aggregate !== 'object' ||
    Object.keys(aggregate).some(
      (name) => kind !== 'many' || name !== 'totalCount',
    ) ||
    [args.last, args.before, args.after, args.offset].some(
      (value) => value !== undefined,
    )
  )
    throw unavailable();
  const count = (aggregate as Record<string, Record<string, unknown>>)
    .totalCount;
  if (
    count &&
    (count.fromField !== 'id' ||
      count.fromFieldType !== 'UUID' ||
      count.aggregateOperation !== 'COUNT' ||
      count.fromSubFields !== undefined)
  )
    throw unavailable();
  if (kind === 'one') {
    if (
      !read.id ||
      JSON.stringify(args.filter) !== JSON.stringify({ id: { eq: read.id } }) ||
      Object.keys(aggregate).length
    )
      throw unavailable();
  } else {
    const orders = args.orderBy as unknown[] | undefined;
    if (
      read.id ||
      args.first !== read.limit ||
      JSON.stringify(args.filter ?? {}) !== '{}' ||
      (orders &&
        JSON.stringify(orders) !==
          JSON.stringify([{}, { id: 'AscNullsFirst' }]))
    )
      throw unavailable();
  }
};
