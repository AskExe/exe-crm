import { type DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
  READ_NATIVE_ACTION_OWNER_SQL,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

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

function authority() {
  const { lease_token: _secret, ...bound } = tuple;

  return {
    ...bound,
    owner_subject: '88888888-8888-4888-8888-888888888888',
    sql_time: '2026-10-05T12:00:00.123456+08:00',
    lease_expires_at: '2026-10-05T12:10:00.123456+08:00',
  };
}

// Synthetic SQL responses test the closed private reader. They do not qualify
// the Core SQL function, native allocation, package or authenticated observer.
describe('PrivateNativeActionReader', () => {
  const query = jest.fn();
  const database = { query } as unknown as DataSource;

  beforeEach(() => query.mockReset());

  it('refuses by default before sending a SQL request', async () => {
    await expect(
      new PrivateNativeActionReader(database).read(tuple, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { ...tuple, owner_subject: 'caller-owner' },
    Object.assign(Object.create({ authority: 'inherited' }), tuple),
    Object.defineProperty({ ...tuple }, 'extra', { value: 'hidden' }),
    { ...tuple, [Symbol('extra')]: 'hidden' },
  ])('refuses extra or inherited tuple fields before SQL', async (input) => {
    await expect(
      new PrivateNativeActionReader(database, true).read(input, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a tuple getter without executing it or querying SQL', async () => {
    const getter = jest.fn(() => tuple.company_id);
    const input = Object.defineProperty({ ...tuple }, 'company_id', {
      enumerable: true,
      get: getter,
    });
    await expect(
      new PrivateNativeActionReader(database, true).read(input, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(getter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('snapshots the tuple before an awaited SQL read', async () => {
    const input = { ...tuple };
    query.mockImplementation(async () => {
      input.action_id = '99999999-9999-4999-8999-999999999999';
      return [{ authority: authority() }];
    });
    const result = await new PrivateNativeActionReader(database, true).read(
      input,
      1000,
    );
    expect(result.authority.action_id).toBe(tuple.action_id);
    expect(input.action_id).not.toBe(tuple.action_id);
  });

  it('uses the exact parameterized 13-field function and returns no token', async () => {
    query.mockResolvedValue([{ authority: authority() }]);
    const result = await new PrivateNativeActionReader(database, true).read(
      tuple,
      1000,
    );
    expect(query).toHaveBeenCalledWith(READ_NATIVE_ACTION_OWNER_SQL, [
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
    ]);
    expect(result.authority.owner_subject).toBe(authority().owner_subject);
    expect(result.authority).not.toHaveProperty('lease_token');
    expect(Object.isFrozen(result.authority)).toBe(true);
  });

  it.each([
    'company_id',
    'job_id',
    'intent_id',
    'action_id',
    'profile_sha256',
    'config_sha256',
    'initializer_sha256',
    'attempt',
    'worker_id',
  ])('refuses a changed %s in the actual SQL projection', async (key) => {
    query.mockResolvedValue([
      { authority: { ...authority(), [key]: 'changed' } },
    ]);
    await expect(
      new PrivateNativeActionReader(database, true).read(tuple, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });

  it('refuses SQL failure without replacing the original error', async () => {
    const original = new Error('controlled SQL refusal');
    query.mockRejectedValue(original);
    await expect(
      new PrivateNativeActionReader(database, true).read(tuple, 1000),
    ).rejects.toBe(original);
  });

  it.each([
    { rows: [] },
    { rows: [{ authority: authority() }, { authority: authority() }] },
    { rows: [{ authority: { ...authority(), native_id: tuple.company_id } }] },
    {
      rows: [{ authority: { ...authority(), owner_subject: 'not-a-subject' } }],
    },
  ])(
    'refuses missing, duplicate, extended or invalid authority rows',
    async ({ rows }) => {
      query.mockResolvedValue(rows);
      await expect(
        new PrivateNativeActionReader(database, true).read(tuple, 1000),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    },
  );

  it('does not execute a projection getter', async () => {
    const getter = jest.fn(() => authority());
    const row = Object.defineProperty({}, 'authority', {
      enumerable: true,
      get: getter,
    });
    query.mockResolvedValue([row]);
    await expect(
      new PrivateNativeActionReader(database, true).read(tuple, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(getter).not.toHaveBeenCalled();
  });

  it('refuses an expired SQL-relative lease independently of host wall time', async () => {
    query.mockResolvedValue([
      { authority: { ...authority(), lease_expires_at: authority().sql_time } },
    ]);
    await expect(
      new PrivateNativeActionReader(database, true).read(tuple, 1000),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });
});
