import { createHash } from 'node:crypto';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';

import {
  withWorkspaceContext,
  type ORMWorkspaceContext,
} from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

import { type PrivateInsertEvents } from 'src/engine/twenty-orm/repository/private-insert-events';

import {
  PrivatePeopleAdapter,
  PrivatePeopleUncertain,
} from './private-people-adapter';
import { type PrivatePeopleSource } from './private-people-contract';

const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const fixture = () => {
  // Explicit SQL/result carriers. These exercise production handle/identity
  // code, not PostgreSQL ACLs, real ORM insertion or Core authority issuance.
  const bytes = Buffer.from('[{"name":"Contact A","email":"a@example.test"}]');
  const source: PrivatePeopleSource = {
    version: 2,
    purpose: 'business-action',
    subject_id: id(1),
    company_id: id(2),
    product: 'crm',
    resource_kind: 'crm-workspace',
    client_id: 'client-a',
    binding_id: id(3),
    native_id: id(4),
    generation_id: id(5),
    authz_epoch: '1',
    audience: 'crm-a',
    current_role: 'member',
    action: 'crm:people:create',
    policy_revision: '1',
    commerce: null,
    request_id: id(6),
    payload_sha256: createHash('sha256').update(bytes).digest('hex'),
    expires_at: '2099-01-01T00:00:00.000Z',
  };
  const controller = new AbortController();
  let expired = false;
  let guardAllowed = true;
  const end = {
    signal: controller.signal,
    remaining: () => {
      if (expired) throw new Error('original end');
      return 1000;
    },
  };
  const cleanup = {
    signal: new AbortController().signal,
    remaining: () => 1000,
  };
  const user = {
    id: id(7),
    disabled: false,
    isEmailVerified: true,
    canImpersonate: false,
    canAccessFullAdminPanel: false,
    firstName: 'Member',
    lastName: '',
    email: 'member@example.test',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  const workspace = {
    id: id(4),
    activationStatus: 'ACTIVE',
    suspendedAt: null,
    databaseSchema: 'workspace_a',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  const membership = {
    id: id(8),
    userId: id(7),
    workspaceId: id(4),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  const member = {
    id: id(9),
    userId: id(7),
    position: 0,
    calendarStartDay: 1,
    colorScheme: 'Light',
    locale: 'en',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'H24',
    numberFormat: 'SYSTEM',
    avatarUrl: null,
    userEmail: null,
    searchVector: null,
    nameFirstName: 'Member',
    nameLastName: '',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  const role = {
    id: id(10),
    canUpdateAllSettings: false,
    canAccessAllTools: false,
    canReadAllObjectRecords: false,
    canUpdateAllObjectRecords: false,
    canDestroyAllObjectRecords: false,
    canSoftDeleteAllObjectRecords: false,
  };
  const query = jest.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes('AS allowed')) return [{ allowed: guardAllowed }];
    if (sql.startsWith('SELECT * FROM core.workspace')) return [workspace];
    if (sql.startsWith('SELECT * FROM core."user"')) return [user];
    if (sql.startsWith('SELECT * FROM core."userWorkspace"'))
      return [membership];
    if (sql.startsWith('SELECT r.*')) return [role];
    if (sql.startsWith('SELECT p.id')) return [{ id: id(11) }];
    if (sql.startsWith('SELECT * FROM "workspace_a"')) return [member];
    return [];
  });
  let values: Record<string, unknown>[] = [];
  type ControlledBuilder = jest.Mocked<{
    insert: () => ControlledBuilder;
    usePrivateTransaction: (events: PrivateInsertEvents) => ControlledBuilder;
    values: (input: Record<string, unknown>[]) => ControlledBuilder;
    execute: () => Promise<{ identifiers: { id: unknown }[] }>;
  }>;
  const builder: ControlledBuilder = {
    insert: jest.fn(() => builder),
    usePrivateTransaction: jest.fn((_events: PrivateInsertEvents) => builder),
    values: jest.fn((input: Record<string, unknown>[]) => {
      values = input;
      return builder;
    }),
    execute: jest.fn(async () => ({
      identifiers: values.map((row) => ({ id: row.id })),
    })),
  };
  const runner = {
    isReleased: false,
    isTransactionActive: false,
    query,
    connect: jest.fn(async (): Promise<void> => undefined),
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
    manager: {
      getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
    },
  };
  const core = {
    options: {
      type: 'postgres',
      url: 'postgres://readonly:controlled@native.test/db',
    },
    getRepository: () => ({ create: (row: unknown) => row }),
  };
  const roleMap = { [id(8)]: id(10) };
  const dataSource = {
    coreDataSource: core,
    subscribers: [] as unknown[],
    getMetadata: () => ({
      beforeInsertListeners: [],
      afterInsertListeners: [],
    }),
    options: {
      type: 'postgres',
      url: 'postgres://writer:controlled@native.test/db',
      extra: { connectionTimeoutMillis: 250 },
    },
    authContext: { type: 'user', userWorkspaceId: id(8) },
    createQueryRunner: jest.fn(() => runner),
  };
  const composition = {
    enabled: true,
    configuration: {
      companyId: id(2),
      workspaceId: id(4),
      nativeSchema: 'workspace_a',
      bindingId: id(3),
      generationId: id(5),
      clientId: 'client-a',
      audience: 'crm-a',
      bindings: new Map([
        [
          id(1),
          {
            subject_id: id(1),
            user_id: id(7),
            user_workspace_id: id(8),
            workspace_member_id: id(9),
          },
        ],
      ]),
    },
    core,
    orm: {
      getGlobalWorkspaceDataSource: jest.fn(async () => dataSource),
      executeInWorkspaceContext: (
        callback: () => Promise<void>,
        authContext: WorkspaceAuthContext,
      ) =>
        withWorkspaceContext(
          { authContext, userWorkspaceRoleMap: roleMap } as ORMWorkspaceContext,
          callback,
        ),
    },
    cache: { invalidateAndRecompute: jest.fn(async () => undefined) },
    emitter: { emitDatabaseBatchEvent: jest.fn() },
  };
  const adapter = new PrivatePeopleAdapter(
    composition as unknown as ConstructorParameters<
      typeof PrivatePeopleAdapter
    >[0],
  );
  return {
    adapter,
    composition,
    source,
    bytes,
    end,
    cleanup,
    runner,
    query,
    builder,
    dataSource,
    user,
    role,
    wrongCachedRole: () => {
      roleMap[id(8)] = id(99);
    },
    expire: () => {
      expired = true;
      controller.abort();
    },
    broaden: () => {
      guardAllowed = false;
    },
  };
};

describe('private people retained transaction (controlled IO, no SQL qualification)', () => {
  it('createHandle is synchronous and side-effect-free', () => {
    const f = fixture();
    const handle = f.adapter.createHandle(f.source, f.bytes, f.end);
    expect(handle.prepare).toBeDefined();
    expect(
      f.composition.orm.getGlobalWorkspaceDataSource,
    ).not.toHaveBeenCalled();
    expect(f.runner.connect).not.toHaveBeenCalled();
  });
  it('refuses absent/default-off private mode before resource acquisition', () => {
    const f = fixture();
    const adapter = new PrivatePeopleAdapter({
      ...f.composition,
      enabled: false,
    } as unknown as ConstructorParameters<typeof PrivatePeopleAdapter>[0]);
    expect(() => adapter.createHandle(f.source, f.bytes, f.end)).toThrow();
    expect(f.runner.connect).not.toHaveBeenCalled();
  });
  it('refuses a different metadata database before native resource acquisition', async () => {
    const f = fixture();
    f.dataSource.options.url = 'postgres://writer:controlled@other.test/db';
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow();
    expect(f.dataSource.createQueryRunner).not.toHaveBeenCalled();
    await h.dispose(f.cleanup);
  });
  it('refuses a cache role that disagrees with the locked native role', async () => {
    const f = fixture();
    f.wrongCachedRole();
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow();
    expect(f.builder.execute).not.toHaveBeenCalled();
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
  });
  it('refuses unreviewed TypeORM subscribers before native resource acquisition', async () => {
    const f = fixture();
    f.dataSource.subscribers.push({});
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow();
    expect(f.dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(f.builder.execute).not.toHaveBeenCalled();
    await h.dispose(f.cleanup);
  });
  it('projects only contact INSERT fields and writes the exact request ledger on the same runner', async () => {
    const f = fixture();
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await h.prepare();
    const values = f.builder.values.mock.calls[0][0];
    expect(Object.keys(values[0]).sort()).toEqual([
      'createdBy',
      'emails',
      'id',
      'name',
    ]);
    expect(values[0].name).toEqual({ firstName: 'Contact A', lastName: '' });
    const ledger = f.query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO core."privatePeopleRequest"'),
    );
    expect(ledger?.[1]?.slice(0, 4)).toEqual([
      f.source.request_id,
      f.source.company_id,
      f.source.subject_id,
      f.source.native_id,
    ]);
    expect(f.runner.commitTransaction).not.toHaveBeenCalled();
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
  });
  it('acknowledges once, releases the owned runner, then publishes only on Core acceptance', async () => {
    const f = fixture();
    const execute = f.builder.execute.getMockImplementation();
    f.builder.execute.mockImplementation(async () => {
      const queue = f.builder.usePrivateTransaction.mock.calls[0][0];
      queue.retain({
        workspaceId: f.source.native_id,
        action: DatabaseEventAction.CREATED,
        objectMetadataNameSingular: 'person',
        objectMetadata: {},
        events: [{ recordId: f.builder.values.mock.calls[0][0][0].id }],
      } as Parameters<PrivateInsertEvents['retain']>[0]);
      return execute?.() ?? { identifiers: [] };
    });
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await h.prepare();
    const ack = await h.commit();
    expect(ack.request_id).toBe(f.source.request_id);
    expect(ack.native_record_ids).toHaveLength(1);
    expect(ack.commit).toBe('acknowledged');
    expect(f.composition.emitter.emitDatabaseBatchEvent).not.toHaveBeenCalled();
    await h.dispose(f.cleanup);
    await h.postCommit(f.end);
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    expect(f.composition.emitter.emitDatabaseBatchEvent).toHaveBeenCalledTimes(
      1,
    );
    await expect(h.postCommit(f.end)).rejects.toThrow();
  });
  it('foreign workspace binding refuses before INSERT', async () => {
    const f = fixture();
    const h = f.adapter.createHandle(
      { ...f.source, native_id: id(99) },
      f.bytes,
      f.end,
    );
    await expect(h.prepare()).rejects.toThrow();
    expect(f.builder.execute).not.toHaveBeenCalled();
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
  });
  it('changed native user state after prepare refuses COMMIT', async () => {
    const f = fixture();
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await h.prepare();
    f.user.disabled = true;
    await expect(h.commit()).rejects.toBeInstanceOf(PrivatePeopleUncertain);
    expect(f.runner.commitTransaction).not.toHaveBeenCalled();
    await h.dispose(f.cleanup);
  });
  it('refuses an unverified bootstrap owner before contact INSERT', async () => {
    const f = fixture();
    f.user.isEmailVerified = false;
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow();
    expect(f.builder.execute).not.toHaveBeenCalled();
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
  });
  it('refuses native global-record privileges rather than using them for writes', async () => {
    const f = fixture();
    f.role.canUpdateAllObjectRecords = true;
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow();
    expect(f.builder.execute).not.toHaveBeenCalled();
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
  });
  it('fresh privilege broadening after prepare prevents COMMIT', async () => {
    const f = fixture();
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await h.prepare();
    f.broaden();
    await expect(h.commit()).rejects.toBeInstanceOf(PrivatePeopleUncertain);
    expect(f.runner.commitTransaction).not.toHaveBeenCalled();
    await h.dispose(f.cleanup);
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
  it('duplicate ledger error preserves rollback/refusal without a second INSERT', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation();
    f.query.mockImplementation(async (sql) => {
      if (sql.startsWith('INSERT INTO core."privatePeopleRequest"'))
        throw new Error('duplicate');
      return original?.(sql) ?? [];
    });
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await expect(h.prepare()).rejects.toThrow('duplicate');
    await h.rollback(f.cleanup);
    await h.dispose(f.cleanup);
    expect(f.builder.execute).toHaveBeenCalledTimes(1);
    expect(f.runner.commitTransaction).not.toHaveBeenCalled();
  });
  it('lost COMMIT acknowledgement is uncertain and cannot publish or retry', async () => {
    const f = fixture();
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    await h.prepare();
    f.runner.commitTransaction.mockImplementation(async () => {
      f.runner.isTransactionActive = false;
      throw new Error('lost ack');
    });
    await expect(h.commit()).rejects.toBeInstanceOf(PrivatePeopleUncertain);
    await h.dispose(f.cleanup);
    await expect(h.postCommit(f.end)).rejects.toThrow();
    await expect(h.commit()).rejects.toThrow();
    expect(f.runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(f.composition.emitter.emitDatabaseBatchEvent).not.toHaveBeenCalled();
  });
  it('owns late connection acquisition and settles it before releasing, without starting a transaction', async () => {
    const f = fixture();
    let resolve: () => void = () => {};
    f.runner.connect.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    const preparing = h.prepare();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.runner.connect).toHaveBeenCalledTimes(1);
    f.expire();
    await expect(preparing).rejects.toThrow();
    const rollback = h.rollback(f.cleanup);
    resolve();
    await rollback;
    await h.dispose(f.cleanup);
    expect(f.runner.startTransaction).not.toHaveBeenCalled();
    expect(f.runner.release).toHaveBeenCalledTimes(1);
  });
  it('expired disposal remains uncertain and never schedules unbounded late release', async () => {
    const f = fixture();
    let resolve: () => void = () => {};
    f.runner.connect.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const h = f.adapter.createHandle(f.source, f.bytes, f.end);
    const preparing = h.prepare();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.runner.connect).toHaveBeenCalledTimes(1);
    f.expire();
    await expect(preparing).rejects.toThrow();
    const expiredCleanup = {
      signal: new AbortController().signal,
      remaining: () => {
        throw new Error('original cleanup end');
      },
    };
    await expect(h.dispose(expiredCleanup)).rejects.toBeInstanceOf(
      PrivatePeopleUncertain,
    );
    resolve();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.runner.startTransaction).not.toHaveBeenCalled();
    expect(f.runner.release).not.toHaveBeenCalled();
    await expect(h.dispose(f.cleanup)).rejects.toThrow('already used');
    await expect(h.postCommit(f.end)).rejects.toThrow();
  });
});
