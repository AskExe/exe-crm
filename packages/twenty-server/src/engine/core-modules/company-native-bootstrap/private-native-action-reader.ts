import { performance } from 'node:perf_hooks';

import { type PrivateDispatchLifetime } from 'src/engine/core-modules/company-native-bootstrap/private-native-bootstrap-frame';

import { type DataSource } from 'typeorm';

export type PrivateNativeActionTuple = {
  job_id: string;
  lease_token: string;
  attempt: number;
  worker_id: string;
  company_id: string;
  deployment_id: string;
  product: 'crm-workspace';
  profile_sha256: string;
  config_sha256: string;
  initializer_sha256: string;
  request_key: string;
  intent_id: string;
  action_id: string;
};

export type PrivateNativeOwnerProjection = Omit<
  PrivateNativeActionTuple,
  'lease_token'
> & {
  owner_subject: string;
  sql_time: string;
  lease_expires_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const OWNER_KEYS = [
  'job_id',
  'intent_id',
  'action_id',
  'company_id',
  'deployment_id',
  'product',
  'profile_sha256',
  'config_sha256',
  'initializer_sha256',
  'request_key',
  'owner_subject',
  'attempt',
  'worker_id',
  'sql_time',
  'lease_expires_at',
] as const;
const TUPLE_KEYS = [
  'job_id',
  'lease_token',
  'attempt',
  'worker_id',
  'company_id',
  'deployment_id',
  'product',
  'profile_sha256',
  'config_sha256',
  'initializer_sha256',
  'request_key',
  'intent_id',
  'action_id',
] as const;

// This statement runs only on the ephemeral function-only Core connection.
// It must never be registered as a provider in AppModule or tenant HTTP.
export const READ_NATIVE_ACTION_OWNER_SQL = `SELECT core.read_native_action_owner(
  $1::uuid,$2::uuid,$3::integer,$4::text,$5::uuid,$6::uuid,
  $7::text,$8::text,$9::text,$10::text,$11::uuid,$12::uuid,$13::uuid
) AS authority`;

export class PrivateNativeActionUnavailable extends Error {
  constructor() {
    super('Private native action unavailable');
  }
}

function refuseUnless(condition: boolean): asserts condition {
  if (!condition) throw new PrivateNativeActionUnavailable();
}

export function snapshotPrivateNativeActionTuple(
  input: unknown,
): Readonly<PrivateNativeActionTuple> {
  refuseUnless(
    typeof input === 'object' &&
      input !== null &&
      Object.getPrototypeOf(input) === Object.prototype &&
      Reflect.ownKeys(input).length === TUPLE_KEYS.length,
  );
  const fields: Record<string, unknown> = {};
  for (const key of TUPLE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    refuseUnless(
      descriptor !== undefined &&
        'value' in descriptor &&
        descriptor.enumerable === true,
    );
    fields[key] = descriptor.value;
  }
  const tuple = fields as PrivateNativeActionTuple;
  refuseUnless(tuple.product === 'crm-workspace');
  for (const value of [
    tuple.job_id,
    tuple.lease_token,
    tuple.company_id,
    tuple.deployment_id,
    tuple.request_key,
    tuple.intent_id,
    tuple.action_id,
  ]) {
    refuseUnless(typeof value === 'string' && UUID.test(value));
  }
  for (const value of [
    tuple.profile_sha256,
    tuple.config_sha256,
    tuple.initializer_sha256,
  ]) {
    refuseUnless(typeof value === 'string' && HASH.test(value));
  }
  refuseUnless(
    Number.isSafeInteger(tuple.attempt) &&
      tuple.attempt > 0 &&
      tuple.attempt <= 2147483647,
  );
  refuseUnless(
    typeof tuple.worker_id === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(tuple.worker_id),
  );
  return Object.freeze(tuple);
}

export class PrivateNativeActionReader {
  constructor(
    private readonly workerDatabase: DataSource,
    private readonly enabled: boolean = false,
    private readonly dispatchLifetime?: PrivateDispatchLifetime,
  ) {}

  async read(
    input: PrivateNativeActionTuple,
    requiredRemainingMilliseconds: number,
  ): Promise<{
    authority: Readonly<PrivateNativeOwnerProjection>;
    monotonicDeadline: number;
  }> {
    refuseUnless(this.enabled === true);
    const tuple = snapshotPrivateNativeActionTuple(input);
    refuseUnless(
      Number.isSafeInteger(requiredRemainingMilliseconds) &&
        requiredRemainingMilliseconds > 0,
    );
    const before = performance.now();
    // SQL verifies the actual lease, permission and creator after all locks.
    const rows: unknown = await this.workerDatabase.query(
      READ_NATIVE_ACTION_OWNER_SQL,
      [
        tuple.job_id,
        tuple.lease_token,
        tuple.attempt,
        tuple.worker_id,
        tuple.company_id,
        tuple.deployment_id,
        tuple.product,
        tuple.profile_sha256,
        tuple.config_sha256,
        tuple.initializer_sha256,
        tuple.request_key,
        tuple.intent_id,
        tuple.action_id,
      ],
    );
    const after = performance.now();
    refuseUnless(Array.isArray(rows) && rows.length === 1);
    const row: unknown = rows[0];
    refuseUnless(
      typeof row === 'object' &&
        row !== null &&
        Object.keys(row).length === 1 &&
        'authority' in row,
    );
    const authorityDescriptor = Object.getOwnPropertyDescriptor(
      row,
      'authority',
    );
    refuseUnless(
      authorityDescriptor !== undefined && 'value' in authorityDescriptor,
    );
    const value: unknown = authorityDescriptor.value;
    refuseUnless(
      typeof value === 'object' &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype,
    );
    const projection = value as Record<string, unknown>;
    refuseUnless(
      Object.keys(projection).length === OWNER_KEYS.length &&
        OWNER_KEYS.every((key) =>
          Object.prototype.hasOwnProperty.call(projection, key),
        ),
    );
    for (const key of OWNER_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(projection, key);
      refuseUnless(descriptor !== undefined && 'value' in descriptor);
      if (key in tuple) {
        refuseUnless(
          projection[key] === tuple[key as keyof PrivateNativeActionTuple],
        );
      }
    }
    refuseUnless(
      typeof projection.owner_subject === 'string' &&
        UUID.test(projection.owner_subject),
    );
    refuseUnless(
      typeof projection.sql_time === 'string' &&
        TIMESTAMP.test(projection.sql_time),
    );
    refuseUnless(
      typeof projection.lease_expires_at === 'string' &&
        TIMESTAMP.test(projection.lease_expires_at),
    );
    const sqlTime = Date.parse(projection.sql_time);
    const sqlExpiry = Date.parse(projection.lease_expires_at);
    // No comparison between SQL and host wall clocks. Subtract the entire
    // awaited read plus two milliseconds for timestamp truncation precision.
    const remaining = sqlExpiry - sqlTime - (after - before) - 2;
    refuseUnless(
      Number.isFinite(remaining) && remaining > requiredRemainingMilliseconds,
    );
    return {
      authority: Object.freeze({
        ...projection,
      }) as PrivateNativeOwnerProjection,
      monotonicDeadline: this.dispatchLifetime
        ? this.dispatchLifetime.limit(
            sqlTime,
            sqlExpiry,
            before,
            after,
            requiredRemainingMilliseconds,
          )
        : after + remaining,
    };
  }
}
