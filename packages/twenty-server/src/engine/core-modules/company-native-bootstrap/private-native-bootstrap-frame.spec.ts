import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import {
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
} from './private-native-action-reader';
import {
  parsePrivateFirstWriterFrame,
  readPrivateFirstWriterFrame,
  PrivateDispatchLifetime,
} from './private-native-bootstrap-frame';

const tuple: PrivateNativeActionTuple = {
  job_id: '11111111-1111-4111-8111-111111111111',
  lease_token: '22222222-2222-4222-8222-222222222222',
  attempt: 1,
  worker_id: 'owned-private-worker',
  company_id: '33333333-3333-4333-8333-333333333333',
  deployment_id: '44444444-4444-4444-8444-444444444444',
  product: 'crm-workspace',
  profile_sha256: '1'.repeat(64),
  config_sha256: '2'.repeat(64),
  initializer_sha256: '3'.repeat(64),
  request_key: '55555555-5555-4555-8555-555555555555',
  intent_id: '66666666-6666-4666-8666-666666666666',
  action_id: '77777777-7777-4777-8777-777777777777',
};

const frame = () => ({
  version: 'core-first-writer-v1',
  tuple,
  initial_sql_time: '2026-10-05T12:00:00.000+08:00',
  original_lease_expires_at: '2026-10-05T12:04:00.000+08:00',
  remaining_work_milliseconds: 180000,
});
// Actual parser/lifetime only. Stream fixtures are controlled, not pipe trust.
describe('private first-writer receiver', () => {
  beforeEach(() => jest.useRealTimers());
  afterAll(() => jest.useFakeTimers());
  it('admits a closed immutable frame only after actual stream EOF', async () => {
    const stream = new PassThrough();
    const result = readPrivateFirstWriterFrame(stream);
    stream.end(JSON.stringify(frame()) + '\n');
    expect(Object.isFrozen(await result)).toBe(true);
  });
  it.each(['extra', 'getter', 'prototype'])(
    'refuses %s carrier before snapshot',
    (kind) => {
      const value = frame();
      if (kind === 'extra') Object.assign(value, { action: tuple.action_id });
      if (kind === 'getter')
        Object.defineProperty(value, 'tuple', {
          enumerable: true,
          get: () => tuple,
        });
      if (kind === 'prototype')
        Object.setPrototypeOf(value, { supplied: true });
      expect(() => parsePrivateFirstWriterFrame(value)).toThrow(
        PrivateNativeActionUnavailable,
      );
    },
  );
  it.each(['two-lines', 'oversize'])(
    'refuses bounded stream %s',
    async (kind) => {
      const stream = new PassThrough();
      const result = readPrivateFirstWriterFrame(stream);
      stream.end(
        kind === 'two-lines'
          ? JSON.stringify(frame()) + '\n{}\n'
          : Buffer.alloc(16385),
      );
      await expect(result).rejects.toBeInstanceOf(
        PrivateNativeActionUnavailable,
      );
    },
  );
  it('refuses a prematurely closed pipe instead of treating close as EOF', async () => {
    const stream = new PassThrough();
    const result = readPrivateFirstWriterFrame(stream);
    stream.destroy();
    await expect(result).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });
  it('debits SQL transit and never extends work on a renewed or shortened lease', () => {
    const f = parsePrivateFirstWriterFrame(frame());
    const now = performance.now();
    const life = new PrivateDispatchLifetime(f, now + 181000);
    const sql = Date.parse(f.initial_sql_time) + 10000;
    life.limit(
      sql,
      Date.parse(f.original_lease_expires_at),
      now,
      now + 100,
      61000,
    );
    const original = life.workEnd();
    life.limit(sql + 1000, sql + 300000, now + 100, now + 200, 61000);
    expect(life.workEnd()).toBe(original);
    expect(() =>
      life.limit(sql + 2000, sql + 3000, now + 200, now + 300, 61000),
    ).toThrow(PrivateNativeActionUnavailable);
  });
  it.each(['top-level', 'tuple'])(
    'refuses duplicate %s keys before closed parse',
    async (kind) => {
      const stream = new PassThrough();
      const result = readPrivateFirstWriterFrame(stream);
      const raw = JSON.stringify(frame());
      const duplicate =
        kind === 'top-level'
          ? raw.replace('{', '{"version":"core-first-writer-v1",')
          : raw.replace(
              '"tuple":{',
              `"tuple":{"action_id":"${tuple.action_id}",`,
            );
      stream.end(duplicate + '\n');
      await expect(result).rejects.toBeInstanceOf(
        PrivateNativeActionUnavailable,
      );
    },
  );
  it('retains the earliest shortened SQL expiry after a later renewal', () => {
    const f = parsePrivateFirstWriterFrame(frame());
    const now = performance.now();
    const sql = Date.parse(f.initial_sql_time);
    const life = new PrivateDispatchLifetime(f, now + 181000);
    const shortened = life.limit(sql, sql + 90000, now, now + 10, 61000);
    const renewed = life.limit(
      sql + 1000,
      sql + 240000,
      now + 10,
      now + 20,
      61000,
    );
    expect(renewed).toBeLessThan(shortened);
  });
});
