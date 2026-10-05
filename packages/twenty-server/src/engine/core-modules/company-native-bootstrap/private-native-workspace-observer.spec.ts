import { performance } from 'node:perf_hooks';
import { type DataSource } from 'typeorm';
import { PrivateNativeWorkspaceObserver } from './private-native-workspace-observer';
import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
} from './private-native-action-reader';

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

// Actual observer and privilege guard; synthetic SQL catalog/identity rows.
// These controls do not establish a real native login or independent DB proof.
describe('private independent native identity observation', () => {
  beforeEach(() => jest.useRealTimers());
  afterAll(() => jest.useFakeTimers());
  const owner = '88888888-8888-4888-8888-888888888888';
  const nativeIdentifier = `subject-${owner}@native.invalid`;
  function setup(change: Record<string, unknown> = {}) {
    const role = 'owned_observer';
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT session_user AS login'))
        return [
          {
            login: role,
            effective: role,
            rolsuper: false,
            rolbypassrls: false,
            rolcreaterole: false,
            rolcreatedb: false,
            rolreplication: false,
            member: false,
            creates_database_objects: false,
            temporary_objects: false,
            database_owner: false,
          },
        ];
      if (sql.includes('body_matches'))
        return [
          {
            oid: '12345',
            body_matches: true,
            owner_matches: true,
            public_denied: true,
            executable: false,
          },
        ];
      return [
        {
          schema_authority: false,
          object_authority: false,
          routine_authority: false,
          type_authority: false,
          column_authority: false,
        },
      ];
    });
    const rows = [
      {
        actionId: tuple.action_id,
        workspaceId: tuple.company_id,
        userId: tuple.job_id,
        userWorkspaceId: tuple.intent_id,
        activationStatus: 'PENDING_CREATION',
        databaseSchema: null,
        nativeIdentifier,
        nativeEmailVerified: false,
        ...change,
      },
    ];
    const nativeRead = jest.fn(async (sql: string, _parameters?: unknown[]) =>
      sql.startsWith('SELECT') ? rows : [],
    );
    const runner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: nativeRead,
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    const db = {
      query,
      createQueryRunner: () => runner,
    } as unknown as DataSource;
    const read = jest.fn(async () => ({
      authority: { owner_subject: owner },
      monotonicDeadline: performance.now() + 120000,
    }));
    const authority = { read } as unknown as PrivateNativeActionReader;
    return {
      observer: new PrivateNativeWorkspaceObserver(
        db,
        authority,
        '4'.repeat(64),
        role,
        true,
      ),
      runner,
      nativeRead,
      read,
    };
  }
  it('checks actual joined identifier and unverified email before publishing pending identity', async () => {
    const s = setup();
    const observed = await s.observer.observe(tuple);
    expect(observed.readiness).toBe('unverified');
    expect(observed).not.toHaveProperty('nativeIdentifier');
    const call = s.nativeRead.mock.calls.find(([sql]) =>
      sql.startsWith('SELECT'),
    );
    expect(call?.[0]).toContain('u."isEmailVerified"=false AND u.email=$14');
    expect(call?.[1]?.[13]).toBe(nativeIdentifier);
    expect(s.runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(s.read.mock.calls.length).toBeGreaterThan(2);
  });
  it.each([
    { nativeIdentifier: 'other@native.invalid' },
    { nativeEmailVerified: true },
  ])(
    'refuses changed native identity %j and rolls back without publication',
    async (change) => {
      const s = setup(change);
      await expect(s.observer.observe(tuple)).rejects.toBeInstanceOf(
        PrivateNativeActionUnavailable,
      );
      expect(s.runner.commitTransaction).not.toHaveBeenCalled();
      expect(s.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(s.runner.release).toHaveBeenCalledTimes(1);
    },
  );
});
