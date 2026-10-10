import { createHash } from 'node:crypto';

import { Client } from 'pg';

import { DataSource, type QueryRunner } from 'typeorm';
import { v5 } from 'uuid';

import {
  bindPrivateNativeEditorActivationAdapter,
  type NativeEditorActivationProjection,
} from './private-native-editor-activation-credential';
import { PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY } from './private-native-editor-activation-policy';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const setup = async (write = false) => {
  const association = {
    actionId: id(20),
    companyId: id(2),
    subjectId: id(3),
    workspaceId: id(4),
    profileSha256: 'c'.repeat(64),
    databaseAssociationSha256: 'd'.repeat(64),
  };
  const source: NativeEditorActivationProjection = {
    version: 2,
    entitlement_kind: 'beta',
    commerce: null,
    purpose: 'native-identity-activation',
    action: 'crm:native-identity:activate',
    product: 'crm',
    resource_kind: 'crm-workspace',
    current_role: 'owner',
    verified_email: 'verified@example.test',
    email_confirmed_at: '2020-01-01T00:00:00.000Z',
    identity_sha256: 'a'.repeat(64),
    subject_id: id(3),
    company_id: id(2),
    client_id: 'crm',
    binding_id: id(10),
    native_id: id(4),
    generation_id: id(11),
    authz_epoch: '1',
    audience: 'crm',
    policy_revision: '1',
    activation_scopes: write ? ['crm:read', 'crm:write'] : ['crm:read'],
    request_id: id(1),
    payload_sha256: '',
    expires_at: new Date(Date.now() + 4500).toISOString(),
    parent_session_id: id(5),
    parent_exp: '2000000000',
    attempt: 1,
    coordinator_id: 'crm-coordinator',
  };
  const payload = Buffer.from(
    JSON.stringify({
      subject_id: source.subject_id,
      verified_email: source.verified_email,
      email_confirmed_at: source.email_confirmed_at,
      identity_sha256: source.identity_sha256,
      activation_scopes: source.activation_scopes,
    }),
  );
  const projection = {
    ...source,
    payload_sha256: createHash('sha256').update(payload).digest('hex'),
  };
  const ack = {
    request_id: id(1),
    company_id: id(2),
    subject_id: id(3),
    workspace_id: id(4),
    identity_sha256: 'a'.repeat(64),
    parent_session_id: id(5),
    parent_exp: '2000000000',
    user_id: id(6),
    user_workspace_id: id(7),
    workspace_member_id: id(8),
    role_id: v5(
      write
        ? 'private-native-stock-record-writer-role-v1'
        : 'private-native-stock-record-reader-role-v1',
      id(20),
    ),
    commit: 'acknowledged',
  };
  const catalog = {
    identity: true,
    ceiling: true,
    helper: true,
    body: PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY,
  };
  const database = new DataSource({
    type: 'postgres',
    url: 'postgres://exe_crm_native_identity_activator@127.0.0.1/native',
    connectTimeoutMS: 500,
  });
  jest.replaceProperty(database, 'isInitialized', true);
  jest.spyOn(database, 'query').mockResolvedValue([catalog]);
  const businessConnection = new Client({
    connectionString:
      'postgres://exe_crm_native_identity_activator@127.0.0.1/native',
  });
  Object.defineProperty(businessConnection, 'processID', { value: 12345 });
  jest.spyOn(Client.prototype, 'connect').mockImplementation(async () => {});
  const controlQuery = jest
    .spyOn(Client.prototype, 'query')
    .mockImplementation(async () => ({
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          pid: 12345,
          start: '2026-10-09 00:00:00+00',
          database: 'native',
          user: 'exe_crm_native_identity_activator',
          cancelled: true,
        },
      ],
    }));
  const controlEnd = jest
    .spyOn(Client.prototype, 'end')
    .mockImplementation(async () => {});
  const runner = {
    isTransactionActive: false,
    isReleased: false,
    connect: jest.fn(async () => businessConnection),
    startTransaction: jest.fn(async () => {
      runner.isTransactionActive = true;
    }),
    commitTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    release: jest.fn(async () => {
      runner.isReleased = true;
    }),
    query: jest.fn(async (sql: string, _args?: unknown[]): Promise<unknown> => {
      if (sql.includes('FROM pg_proc p')) return [catalog];
      if (sql.startsWith('SELECT set_config')) return [];
      return [
        {
          result: {
            ackUtf8: Buffer.from(JSON.stringify(ack)).toString('base64'),
            receiptInputUtf8: Buffer.from(
              JSON.stringify([id(1), projection.payload_sha256, ack]),
            ).toString('base64'),
          },
        },
      ];
    }),
  };
  jest
    .spyOn(database, 'createQueryRunner')
    .mockReturnValue(runner as unknown as QueryRunner);
  const workspaceCache = { invalidateAndRecompute: jest.fn(async () => {}) };
  const entityCache = { invalidate: jest.fn(async () => {}) };
  const controller = new AbortController();
  const end = { signal: controller.signal, remaining: () => 4000 };
  const adapter = await bindPrivateNativeEditorActivationAdapter(
    true,
    database,
    association,
    workspaceCache as unknown as Parameters<
      typeof bindPrivateNativeEditorActivationAdapter
    >[3],
    entityCache as unknown as Parameters<
      typeof bindPrivateNativeEditorActivationAdapter
    >[4],
    end,
  );
  const cleanup = {
    signal: new AbortController().signal,
    remaining: () => 1000,
  };
  return {
    adapter,
    businessConnection,
    controlQuery,
    controlEnd,
    database,
    runner,
    catalog,
    projection,
    payload,
    ack,
    workspaceCache,
    entityCache,
    end,
    cleanup,
    controller,
  };
};
afterEach(() => jest.restoreAllMocks());

describe('fixed V2 native activation handle (controlled SQL boundary)', () => {
  it.each([false, true])(
    'prepares and settles only the fixed scoped role write=%s',
    async (write) => {
      const f = await setup(write);
      const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
      expect(f.runner.connect).not.toHaveBeenCalled();
      await handle.prepare();
      expect(f.runner.commitTransaction).not.toHaveBeenCalled();
      const call = f.runner.query.mock.calls.find(([sql]) =>
        sql.includes('SELECT core.activate_original_crm_editor_identity'),
      );
      expect(JSON.parse(String(call?.[1]?.[0]))).toEqual(
        expect.objectContaining({
          action_id: id(20),
          attempt: '1',
          coordinator_id: 'crm-coordinator',
        }),
      );
      expect(f.entityCache.invalidate).not.toHaveBeenCalled();
      expect(await handle.commit()).toEqual(f.ack);
      await handle.dispose(f.cleanup);
      await handle.postCommit(f.cleanup);
      expect(f.runner.release).toHaveBeenCalledTimes(1);
      expect(f.entityCache.invalidate).toHaveBeenCalledWith('user', id(6));
      expect(f.workspaceCache.invalidateAndRecompute).toHaveBeenCalledWith(
        id(4),
        ['flatRoleTargetMaps', 'userWorkspaceRoleMap', 'rolesPermissions'],
      );
    },
  );
  it('refuses foreign binding or scope upgrade without native acquisition', async () => {
    const f = await setup();
    expect(() =>
      f.adapter.createHandle(
        { ...f.projection, company_id: id(99) },
        f.payload,
        f.end,
      ),
    ).toThrow();
    expect(() =>
      f.adapter.createHandle(
        { ...f.projection, activation_scopes: ['crm:read', 'crm:write'] },
        f.payload,
        f.end,
      ),
    ).toThrow();
    expect(f.runner.connect).not.toHaveBeenCalled();
  });
  it('refuses malformed projection and accessor scopes before acquisition', async () => {
    const f = await setup();
    for (const delta of [
      { binding_id: 'foreign' },
      { identity_sha256: 'invalid' },
      { authz_epoch: '1.5' },
      { audience: 'https://foreign' },
    ]) {
      expect(() =>
        f.adapter.createHandle({ ...f.projection, ...delta }, f.payload, f.end),
      ).toThrow();
    }
    const getter = jest.fn(() => 'crm:read');
    const scopes = ['crm:read'];
    Object.defineProperty(scopes, '0', { get: getter, enumerable: true });
    expect(() =>
      f.adapter.createHandle(
        { ...f.projection, activation_scopes: scopes as ['crm:read'] },
        f.payload,
        f.end,
      ),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(f.runner.connect).not.toHaveBeenCalled();
  });
  it('captures private payload before the caller zeroes its buffer', async () => {
    const f = await setup();
    const expected = Buffer.from(f.payload);
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    f.payload.fill(0);
    await handle.prepare();
    const call = f.runner.query.mock.calls.find(([sql]) =>
      sql.includes('SELECT core.activate_original_crm_editor_identity'),
    );
    expect(call?.[1]?.[1]).toEqual(expected);
    await handle.rollback(f.cleanup);
    await handle.dispose(f.cleanup);
  });
  it('cancellation during acquisition prevents mutation and releases the late runner', async () => {
    const f = await setup();
    let release!: () => void;
    let connected!: () => void;
    const acquiring = new Promise<void>((resolve) => {
      connected = resolve;
    });
    f.runner.connect.mockImplementation(
      () =>
        new Promise<Client>((resolve) => {
          release = () => resolve(f.businessConnection);
          connected();
        }),
    );
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    const preparing = handle.prepare();
    await acquiring;
    f.controller.abort();
    release();
    await expect(preparing).rejects.toThrow();
    await expect(handle.dispose(f.cleanup)).rejects.toThrow();
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    expect(f.runner.startTransaction).not.toHaveBeenCalled();
  });
  it('unknown commit refuses publication and preserves a falsy rejection', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    f.runner.commitTransaction.mockRejectedValue(false);
    await expect(handle.commit()).rejects.toBe(false);
    await expect(handle.rollback(f.cleanup)).rejects.toThrow();
    await expect(handle.dispose(f.cleanup)).rejects.toMatchObject({
      errors: [false],
    });
    await expect(handle.postCommit(f.cleanup)).rejects.toThrow();
    expect(f.entityCache.invalidate).not.toHaveBeenCalled();
  });
  it('retains every cleanup failure including a falsy primary', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    f.runner.rollbackTransaction.mockRejectedValue(null);
    const secondary = new Error('release');
    f.runner.release.mockRejectedValue(secondary);
    try {
      await handle.dispose(f.cleanup);
      throw Error('unexpected success');
    } catch (error) {
      expect((error as { errors: unknown[] }).errors).toEqual([
        null,
        secondary,
        expect.any(Error),
      ]);
    }
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    await expect(handle.postCommit(f.cleanup)).rejects.toThrow();
  });
  it('a post-COMPLETE cache failure is not reported as publication success', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    await handle.commit();
    await handle.dispose(f.cleanup);
    f.workspaceCache.invalidateAndRecompute.mockRejectedValue(
      new Error('cache'),
    );
    await expect(handle.postCommit(f.cleanup)).rejects.toThrow('cache');
  });
  it.each(['startTransaction', 'helper', 'commit'] as const)(
    'settles a delayed %s before release and cancels only its captured backend',
    async (phase) => {
      const f = await setup();
      const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
      const events: string[] = [];
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let rejectOperation!: (error: unknown) => void;
      const stalled = () =>
        new Promise<never>((_, reject) => {
          events.push('entered');
          rejectOperation = reject;
          entered();
        });
      if (phase === 'commit') await handle.prepare();
      if (phase === 'startTransaction')
        f.runner.startTransaction.mockImplementation(stalled);
      if (phase === 'helper') {
        const original = f.runner.query.getMockImplementation()!;
        f.runner.query.mockImplementation((sql, args) =>
          sql.includes('core.activate_original_crm_editor_identity')
            ? stalled()
            : original(sql, args),
        );
      }
      if (phase === 'commit')
        f.runner.commitTransaction.mockImplementation(stalled);
      const identity = {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            pid: 12345,
            start: '2026-10-09 00:00:00+00',
            database: 'native',
            user: 'exe_crm_native_identity_activator',
            cancelled: true,
          },
        ],
      };
      f.controlQuery.mockImplementation(async (sql) => {
        if (typeof sql === 'string' && sql.includes('pg_cancel_backend')) {
          events.push('cancel');
          rejectOperation(new Error('owned cancellation 57014'));
        }
        return identity;
      });
      f.runner.release.mockImplementation(async () => {
        events.push('release');
        f.runner.isReleased = true;
      });
      const operation = phase === 'commit' ? handle.commit() : handle.prepare();
      // Attach its rejection before abort; no unhandled-rejection proof shortcut.
      const observed = operation.catch((error: unknown) => {
        events.push('settled');
        return error;
      });
      await started;
      f.controller.abort();
      const disposal = handle.dispose(f.cleanup);
      await expect(observed).resolves.toEqual(expect.any(Error));
      await expect(disposal).rejects.toThrow();
      expect(events.indexOf('release')).toBeGreaterThan(
        events.indexOf('settled'),
      );
      const cancellation = f.controlQuery.mock.calls.find(
        ([sql]) => typeof sql === 'string' && sql.includes('pg_cancel_backend'),
      );
      expect(cancellation?.[1]).toEqual([
        12345,
        '2026-10-09 00:00:00+00',
        'native',
        'exe_crm_native_identity_activator',
      ]);
      expect(f.controlEnd).toHaveBeenCalledTimes(1);
      expect(f.entityCache.invalidate).not.toHaveBeenCalled();
      if (phase === 'commit')
        expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it('a delayed rollback is settled before disposal releases, retaining falsy error', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let rejectRollback!: (error: unknown) => void;
    f.runner.rollbackTransaction.mockImplementation(
      () =>
        new Promise<never>((_, reject) => {
          rejectRollback = reject;
          entered();
        }),
    );
    const rollback = handle
      .rollback(f.cleanup)
      .catch((error: unknown) => error);
    await started;
    const disposal = handle.dispose(f.cleanup);
    expect(f.runner.release).not.toHaveBeenCalled();
    rejectRollback(null);
    await expect(rollback).resolves.toBeNull();
    // Already-failed rollback is not automatically retried during dispose.
    f.runner.isTransactionActive = false;
    await expect(disposal).rejects.toMatchObject({ errors: [null] });
    expect(f.runner.release).toHaveBeenCalledTimes(1);
  });

  it('dispose owns its delayed rollback and never releases it while unsettled', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    f.runner.rollbackTransaction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            f.runner.isTransactionActive = false;
            resolve();
          };
          entered();
        }),
    );
    const disposal = handle.dispose(f.cleanup);
    await started;
    expect(f.runner.release).not.toHaveBeenCalled();
    finish();
    await disposal;
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    expect(f.controlEnd).toHaveBeenCalledTimes(1);
  });

  it('settles the actual cancellation reply before releasing after a delayed helper', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let rejectHelper!: (error: unknown) => void;
    const originalQuery = f.runner.query.getMockImplementation()!;
    f.runner.query.mockImplementation((sql, args) =>
      sql.includes('core.activate_original_crm_editor_identity')
        ? new Promise<never>((_, reject) => {
            rejectHelper = reject;
            entered();
          })
        : originalQuery(sql, args),
    );
    const identity = {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          pid: 12345,
          start: '2026-10-09 00:00:00+00',
          database: 'native',
          user: 'exe_crm_native_identity_activator',
          cancelled: true,
        },
      ],
    };
    let cancelEntered!: () => void;
    const cancelling = new Promise<void>((resolve) => {
      cancelEntered = resolve;
    });
    let reply!: () => void;
    f.controlQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('pg_cancel_backend')) {
        rejectHelper(false);
        cancelEntered();
        await new Promise<void>((resolve) => {
          reply = resolve;
        });
      }
      return identity;
    });
    const observed = handle.prepare().catch((error: unknown) => error);
    await started;
    f.controller.abort();
    const disposal = handle.dispose(f.cleanup);
    await cancelling;
    await expect(observed).resolves.toBe(false);
    expect(f.runner.release).not.toHaveBeenCalled();
    reply();
    await expect(disposal).rejects.toMatchObject({ errors: [false] });
    expect(f.runner.release).toHaveBeenCalledTimes(1);
  });

  it('a stalled control end is bounded by cleanup cancellation and stays unknown', async () => {
    const f = await setup();
    const handle = f.adapter.createHandle(f.projection, f.payload, f.end);
    await handle.prepare();
    await handle.rollback(f.cleanup);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    f.controlEnd.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          entered();
        }),
    );
    const cleanupController = new AbortController();
    const disposal = handle.dispose({
      signal: cleanupController.signal,
      remaining: () => 1000,
    });
    await started;
    cleanupController.abort();
    await expect(disposal).rejects.toThrow();
    await expect(handle.postCommit(f.cleanup)).rejects.toThrow();
    expect(f.entityCache.invalidate).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
  });
});
