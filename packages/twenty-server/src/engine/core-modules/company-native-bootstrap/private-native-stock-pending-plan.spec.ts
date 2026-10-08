import { performance } from 'node:perf_hooks';

import { DataSource } from 'typeorm';
import { v5 } from 'uuid';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import {
  PrivateNativeActionReader,
  PrivateNativeActionUnavailable,
  type PrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import {
  createPrivateStockSetupIdentity,
  PrivateNativeStockSetupUncertain,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-identity';
import {
  PrivateNativeStockRoleGuard,
  PRIVATE_NATIVE_STOCK_ROLE,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { PrivateNativeStockPoolCustody } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pool-custody';
import { fencePrivateStockQueryRunner } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-query-fence';
import {
  installPrivateStockParentFunctions,
  PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-installer';
import { PrivateNativeStockParentLifecycle } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-parent-lifecycle';
import {
  PrivateNativeStockSetupSession,
  PrivateNativeStockSessionUncertain,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-setup-session';
import { PrivateNativeStockOutputObserver } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-output-observer';
import { PrivateNativeStockStorage } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage';
import { readStockPendingNativePlan } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pending-plan';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

jest.mock('src/engine/core-modules/application/application.entity', () => ({
  ApplicationEntity: class {},
}));
jest.mock(
  'src/engine/core-modules/user-workspace/user-workspace.entity',
  () => ({ UserWorkspaceEntity: class {} }),
);
jest.mock('src/engine/core-modules/user/user.entity', () => ({
  UserEntity: class {},
}));
jest.mock('src/engine/core-modules/workspace/workspace.entity', () => ({
  WorkspaceEntity: class {},
}));

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const tuple: PrivateNativeActionTuple = {
  job_id: id('1'),
  lease_token: id('2'),
  attempt: 1,
  worker_id: 'controlled',
  company_id: id('3'),
  deployment_id: id('4'),
  product: 'crm-workspace',
  profile_sha256: '1'.repeat(64),
  config_sha256: '2'.repeat(64),
  initializer_sha256: '3'.repeat(64),
  request_key: id('5'),
  intent_id: id('6'),
  action_id: id('7'),
};
const owner = id('8');
const workspaceId = id('9');
const userId = id('a');
const userWorkspaceId = id('b');
const applicationId = id('c');
const endpoint = { database: 'native', address: '10.0.0.2', port: 5432 };

// Actual issued fence with inert SQL/catalog responses. These controls prove
// source confinement and revocation ordering, not database privileges or setup.
describe('stock pending plan materialization', () => {
  let revoked: boolean;
  let rows: Record<string, unknown>[];
  let readIndex: number;
  let afterRead: (() => void) | undefined;
  let getRepository: jest.Mock;
  let target: DataSource;
  let workEnd: number;

  async function issued() {
    const { lease_token: _secret, ...projection } = tuple;
    const sqlStart = Date.now();
    const monotonicStart = performance.now();
    const worker = {
      query: jest.fn(async () => {
        if (revoked) throw new PrivateNativeActionUnavailable();
        return [
          {
            authority: {
              ...projection,
              owner_subject: owner,
              sql_time: new Date(
                sqlStart + performance.now() - monotonicStart,
              ).toISOString(),
              lease_expires_at: new Date(sqlStart + 600000).toISOString(),
            },
          },
        ];
      }),
    } as unknown as DataSource;
    const original = {
      query: jest.fn(async (sql: string) =>
        sql.includes('inet_server_addr')
          ? [endpoint]
          : sql.includes('JOIN core.')
            ? [
                {
                  actionId: tuple.action_id,
                  workspaceId,
                  userId,
                  userWorkspaceId,
                  applicationId,
                  ownerSubject: owner,
                  databaseSchema: null,
                },
              ]
            : [{ actionId: tuple.action_id }],
      ),
    } as unknown as DataSource;
    workEnd = performance.now() + 10000;
    return PrivateNativeMutationFence.bindCommittedMarker(
      original,
      new PrivateNativeActionReader(worker, true),
      tuple,
      owner,
      workEnd,
      performance.now() + 120000,
      61000,
      'controlled_writer',
    );
  }

  beforeEach(() => {
    revoked = false;
    readIndex = 0;
    afterRead = undefined;
    rows = [
      {
        id: workspaceId,
        activationStatus: 'PENDING_CREATION',
        databaseSchema: null,
        workspaceCustomApplicationId: applicationId,
        deletedAt: null,
        suspendedAt: null,
      },
      {
        id: userId,
        email: `subject-${owner}@native.invalid`,
        deletedAt: null,
        disabled: false,
        isEmailVerified: false,
        passwordHash: null,
        canImpersonate: false,
        canAccessFullAdminPanel: false,
      },
      { id: userWorkspaceId, workspaceId, userId, deletedAt: null },
      {
        id: applicationId,
        workspaceId,
        universalIdentifier: applicationId,
        deletedAt: null,
      },
    ];
    getRepository = jest.fn(() => ({
      findOneBy: jest.fn(async () => {
        const row = rows[readIndex++];
        afterRead?.();
        return row;
      }),
    }));
    target = {
      query: jest.fn(async () => [endpoint]),
      getRepository,
    } as unknown as DataSource;
    jest
      .spyOn(PrivateNativeDatabaseGuard.prototype, 'assertCurrent')
      .mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses only original IDs and returns frozen pending snapshots without mutation', async () => {
    const plan = await readStockPendingNativePlan(await issued(), target);
    expect(plan.original.workspaceId).toBe(workspaceId);
    expect(plan.original.userId).toBe(userId);
    expect(getRepository.mock.calls.map(([entity]) => entity)).toEqual([
      WorkspaceEntity,
      UserEntity,
      UserWorkspaceEntity,
      ApplicationEntity,
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.workspace)).toBe(true);
    expect(Object.isFrozen(plan.subjectUser)).toBe(true);
    expect(readIndex).toBe(4);
  });
  it('rejects an unissued caller fence before any repository access', async () => {
    await expect(
      readStockPendingNativePlan({} as PrivateNativeMutationFence, target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(getRepository).not.toHaveBeenCalled();
    expect(target.query).not.toHaveBeenCalled();
  });
  it('rejects a foreign native endpoint before repository access', async () => {
    jest
      .mocked(target.query)
      .mockResolvedValue([{ ...endpoint, database: 'foreign' }]);
    await expect(
      readStockPendingNativePlan(await issued(), target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(getRepository).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])('rejects foreign row IDs at read %s', async (index) => {
    rows[index].id = id('e');
    await expect(
      readStockPendingNativePlan(await issued(), target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(readIndex).toBe(index + 1);
  });
  it.each(['ACTIVE', 'ONGOING_CREATION'])(
    'refuses %s without reading the subject',
    async (activationStatus) => {
      rows[0].activationStatus = activationStatus;
      await expect(
        readStockPendingNativePlan(await issued(), target),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(readIndex).toBe(1);
    },
  );
  it('refuses a prepared schema instead of adopting it', async () => {
    rows[0].databaseSchema = 'already_prepared';
    await expect(
      readStockPendingNativePlan(await issued(), target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(readIndex).toBe(1);
  });
  it.each([0, 1, 2, 3])(
    'rejects current authority revocation after read %s',
    async (index) => {
      afterRead = () => {
        if (readIndex === index + 1) revoked = true;
      };
      await expect(
        readStockPendingNativePlan(await issued(), target),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(readIndex).toBe(index + 1);
    },
  );
  it('rejects the original deadline crossing during an awaited read', async () => {
    afterRead = () => {
      jest.spyOn(performance, 'now').mockReturnValue(workEnd + 1);
    };
    await expect(
      readStockPendingNativePlan(await issued(), target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(readIndex).toBe(1);
  });
  it('retains issued IDs after stock status changes without reusing pending row reads', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    rows[0].activationStatus = 'ACTIVE';
    const originalReads = readIndex;
    await checkpoint.assertCurrent();
    expect(readIndex).toBe(originalReads);
    expect(checkpoint.pendingPlan.workspace.activationStatus).toBe(
      'PENDING_CREATION',
    );
    expect(checkpoint.pendingPlan.original.workspaceId).toBe(workspaceId);
    expect(Object.isFrozen(checkpoint)).toBe(true);
  });
  it('rejects a copied checkpoint and an equal-looking foreign datasource', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    expect(() =>
      PrivateNativeStockActionCheckpoint.assertIssued({
        ...checkpoint,
      } as PrivateNativeStockActionCheckpoint),
    ).toThrow(PrivateNativeActionUnavailable);
    const foreign = {
      query: jest.fn(async () => [endpoint]),
    } as unknown as DataSource;
    await expect(
      checkpoint.assertNativeDatabase(foreign),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(foreign.query).not.toHaveBeenCalled();
  });
  it('refuses stock checkpoint after original action revocation', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    revoked = true;
    await expect(checkpoint.assertCurrent()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
  });
  it('refuses revocation during the native endpoint read', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    jest.mocked(target.query).mockImplementation(async () => {
      revoked = true;
      return [endpoint];
    });
    await expect(
      checkpoint.assertNativeDatabase(target),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });
  it('keeps the original absolute deadline after stock checkpoint issuance', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    jest.spyOn(performance, 'now').mockReturnValue(workEnd + 1);
    await expect(checkpoint.assertCurrent()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
  });

  async function stockRunner() {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    const database = new DataSource({ type: 'postgres' });
    jest.spyOn(database, 'query').mockResolvedValue([endpoint]);
    const runner = database.createQueryRunner();
    const sql = jest.spyOn(runner, 'query').mockResolvedValue([]);
    const release = jest.spyOn(runner, 'release').mockResolvedValue();
    await fencePrivateStockQueryRunner(database, runner, checkpoint);
    return { checkpoint, database, runner, sql, release };
  }

  it('forwards actual TypeORM runner structured arguments and result unchanged', async () => {
    const { runner, sql } = await stockRunner();
    const structured = { records: [{ id: userId }], affected: 1, raw: [] };
    sql.mockResolvedValueOnce(structured);
    const parameters = [userId];
    expect(await runner.query('SELECT $1', parameters, true)).toBe(structured);
    expect(sql.mock.calls[0]).toEqual(['SELECT $1', parameters, true]);
    await runner.release();
    await expect(runner.query('SELECT 1')).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it('refuses before SQL and permits only native terminal rollback and release', async () => {
    const { runner, sql, release } = await stockRunner();
    await runner.startTransaction();
    const before = sql.mock.calls.length;
    revoked = true;
    await expect(
      runner.query('UPDATE core.workspace SET id=id'),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(sql).toHaveBeenCalledTimes(before);
    await runner.rollbackTransaction();
    expect(sql.mock.calls[sql.mock.calls.length - 1]).toEqual(['ROLLBACK']);
    await expect(runner.query('SELECT 1')).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    await runner.release();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('refuses after actual COMMIT without claiming the committed SQL was undone', async () => {
    const { runner, sql } = await stockRunner();
    await runner.startTransaction();
    sql.mockImplementation(async (query) => {
      if (query === 'COMMIT') revoked = true;
      return [];
    });
    await expect(runner.commitTransaction()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    expect(sql.mock.calls.some(([query]) => query === 'COMMIT')).toBe(true);
    await expect(runner.query('SELECT 1')).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    await runner.rollbackTransaction();
    await runner.release();
  });
  it('retains a primary native query error and closes the held runner', async () => {
    const { runner, sql, release } = await stockRunner();
    const primary = new Error('inert native query failure');
    sql.mockRejectedValueOnce(primary);
    await expect(runner.query('SELECT 1')).rejects.toBe(primary);
    await runner.release();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('does not allow arbitrary SQL while the native rollback method is running', async () => {
    const { runner, sql } = await stockRunner();
    await runner.startTransaction();
    const originalRollback = runner.rollbackTransaction;
    // Native rollback listeners are asynchronous; no cleanup exemption may
    // authorize a different query on the same runner during that interval.
    const releaseListener = jest.fn(async () => {
      await expect(
        runner.query('DELETE FROM core.workspace'),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    });
    jest
      .spyOn(runner.broadcaster, 'broadcast')
      .mockImplementation(releaseListener);
    await Reflect.apply(originalRollback, runner, []);
    expect(
      sql.mock.calls.some(([query]) => query === 'DELETE FROM core.workspace'),
    ).toBe(false);
    await runner.release();
  });

  async function setupIdentityRunner(afterSql?: (query: string) => void) {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    const database = new DataSource({ type: 'postgres' });
    const identity = {
      userId: v5('private-native-stock-setup-user-v1', tuple.action_id),
      userWorkspaceId: v5(
        'private-native-stock-setup-membership-v1',
        tuple.action_id,
      ),
      workspaceId,
    };
    jest.spyOn(database, 'query').mockImplementation(async (query) => {
      if (query.includes('inet_server_addr')) return [endpoint];
      if (query.includes('schema_absent'))
        return [
          {
            schema_absent: true,
            datasource_absent: true,
            sole_workspace: true,
            sole_subject: true,
            sole_membership: true,
          },
        ];
      return [
        {
          role_matches: true,
          schema_confined: true,
          functions_confined: true,
          types_confined: true,
          relations_confined: true,
          stock_grants_match: true,
          public_defaults_denied: true,
        },
      ];
    });
    const runner = database.createQueryRunner();
    const sql = jest
      .spyOn(runner, 'query')
      .mockImplementation(async (query) => {
        afterSql?.(query);
        if (query.includes('INSERT INTO core."user"'))
          return [
            {
              id: identity.userId,
              disabled: true,
              isEmailVerified: false,
              passwordHash: null,
              canImpersonate: false,
              canAccessFullAdminPanel: false,
            },
          ];
        if (query.includes('INSERT INTO core."userWorkspace"'))
          return [
            {
              id: identity.userWorkspaceId,
              userId: identity.userId,
              workspaceId,
            },
          ];
        return [];
      });
    jest.spyOn(runner, 'connect').mockResolvedValue(undefined);
    const release = jest.spyOn(runner, 'release').mockResolvedValue();
    jest.spyOn(database, 'createQueryRunner').mockReturnValue(runner);
    return { checkpoint, database, identity, runner, sql, release };
  }
  it('creates only the disabled setup identity under derived IDs with a separate setup membership', async () => {
    const fixture = await setupIdentityRunner();
    expect(
      await createPrivateStockSetupIdentity(
        fixture.checkpoint,
        fixture.database,
      ),
    ).toEqual(fixture.identity);
    const inserts = fixture.sql.mock.calls.filter(([query]) =>
      query.startsWith('INSERT'),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual([
      fixture.identity.userId,
      `setup-${fixture.identity.userId}@native.invalid`,
    ]);
    expect(inserts[1][1]).toEqual([
      fixture.identity.userWorkspaceId,
      fixture.identity.userId,
      workspaceId,
    ]);
    expect(fixture.identity.userId).not.toBe(userId);
    expect(fixture.identity.userWorkspaceId).not.toBe(userWorkspaceId);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  it('rolls back and closes after current action revocation during setup User insertion', async () => {
    const fixture = await setupIdentityRunner((query) => {
      if (query.startsWith('INSERT')) revoked = true;
    });
    await expect(
      createPrivateStockSetupIdentity(fixture.checkpoint, fixture.database),
    ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect(
      fixture.sql.mock.calls.filter(([query]) => query.startsWith('INSERT')),
    ).toHaveLength(1);
    expect(fixture.sql.mock.calls.some(([query]) => query === 'ROLLBACK')).toBe(
      true,
    );
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  it('quarantines a lost COMMIT acknowledgement without compensating or retrying the transaction', async () => {
    const primary = new Error('inert lost commit ack');
    const fixture = await setupIdentityRunner((query) => {
      if (query === 'COMMIT') throw primary;
    });
    let error: unknown;
    try {
      await createPrivateStockSetupIdentity(
        fixture.checkpoint,
        fixture.database,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect((error as PrivateNativeStockSetupUncertain).primary).toBe(primary);
    expect(
      fixture.sql.mock.calls.filter(([query]) => query === 'COMMIT'),
    ).toHaveLength(1);
    expect(
      fixture.sql.mock.calls.some(
        ([query]) => query === 'ROLLBACK' || query.startsWith('DELETE'),
      ),
    ).toBe(false);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  async function installerRunner(
    mode: 'success' | 'collision' | 'commit' | 'revoked' | 'parent',
  ) {
    const fixture = await setupIdentityRunner();
    fixture.sql.mockImplementation(async (query, parameters) => {
      if (query.includes('owner_matches'))
        return [{ owner_matches: true, parent_matches: mode !== 'parent' }];
      if (query.includes('AS absent'))
        return [{ absent: mode !== 'collision' }];
      if (query.includes('p.prosrc AS body'))
        return [
          {
            admitted: true,
            body: PRIVATE_NATIVE_STOCK_PARENT_FUNCTIONS.find(
              (operation) => operation.name === parameters?.[0],
            )?.body,
          },
        ];
      if (query.startsWith('CREATE FUNCTION') && mode === 'revoked')
        revoked = true;
      if (query === 'COMMIT' && mode === 'commit')
        throw new Error('inert lost installer commit');
      return [];
    });
    return fixture;
  }
  it('installs only the fixed parent functions with body and ACL readback before one commit', async () => {
    const fixture = await installerRunner('success');
    await installPrivateStockParentFunctions(
      fixture.checkpoint,
      fixture.database,
    );
    expect(
      fixture.sql.mock.calls.filter(([query]) =>
        query.startsWith('CREATE FUNCTION'),
      ),
    ).toHaveLength(4);
    expect(
      fixture.sql.mock.calls.filter(([query]) =>
        query.includes('p.prosrc AS body'),
      ),
    ).toHaveLength(4);
    expect(
      fixture.sql.mock.calls.filter(([query]) => query === 'COMMIT'),
    ).toHaveLength(1);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  it.each(['collision', 'revoked'] as const)(
    'rolls back installer %s refusal without replacement or continued grants',
    async (mode) => {
      const fixture = await installerRunner(mode);
      await expect(
        installPrivateStockParentFunctions(
          fixture.checkpoint,
          fixture.database,
        ),
      ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
      expect(
        fixture.sql.mock.calls.some(([query]) => query === 'ROLLBACK'),
      ).toBe(true);
      expect(
        fixture.sql.mock.calls.some(([query]) =>
          query.includes('CREATE OR REPLACE'),
        ),
      ).toBe(false);
      expect(
        fixture.sql.mock.calls.filter(([query]) => query.startsWith('GRANT')),
      ).toHaveLength(0);
      expect(fixture.release).toHaveBeenCalledTimes(1);
    },
  );
  it('quarantines installer commit acknowledgement loss without rollback or compensating function drop', async () => {
    const fixture = await installerRunner('commit');
    await expect(
      installPrivateStockParentFunctions(fixture.checkpoint, fixture.database),
    ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect(
      fixture.sql.mock.calls.some(
        ([query]) => query === 'ROLLBACK' || query.startsWith('DROP'),
      ),
    ).toBe(false);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  it('refuses extra parent authority before any installation transaction or grant', async () => {
    const fixture = await installerRunner('parent');
    await expect(
      installPrivateStockParentFunctions(fixture.checkpoint, fixture.database),
    ).rejects.toBeInstanceOf(PrivateNativeStockSetupUncertain);
    expect(
      fixture.sql.mock.calls.some(
        ([query]) =>
          query === 'START TRANSACTION' ||
          query.startsWith('CREATE FUNCTION') ||
          query.startsWith('GRANT'),
      ),
    ).toBe(false);
    expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  async function separateControlFixture(drift = false, fenced = true) {
    const state = await setupIdentityRunner();
    const projection = {
      ...endpoint,
      session: PRIVATE_NATIVE_STOCK_ROLE,
      actor: PRIVATE_NATIVE_STOCK_ROLE,
    };
    jest.mocked(target.query).mockImplementation(async (query) =>
      query.includes('inet_server_addr')
        ? [endpoint]
        : [
            {
              role_matches: true,
              schema_confined: true,
              functions_confined: true,
              types_confined: true,
              relations_confined: true,
              stock_grants_match: true,
              public_defaults_denied: true,
            },
          ],
    );
    const control = await PrivateNativeStockRoleGuard.bindControl(
      target,
      state.checkpoint,
    );
    jest
      .spyOn(state.database, 'query')
      .mockImplementation(async () => [projection]);
    state.database.setOptions({
      url: 'postgresql://exe_crm_native_stock_provisioner:fixture-only@10.0.0.2:5432/native',
    });
    await control.bindBusinessDatabase(state.database);
    state.sql.mockImplementation(async (query) =>
      query.includes('inet_server_addr')
        ? [{ ...projection, address: drift ? '10.0.0.99' : projection.address }]
        : [{ value: 7 }],
    );
    if (fenced)
      await fencePrivateStockQueryRunner(
        state.database,
        state.runner,
        state.checkpoint,
        control,
      );
    jest.spyOn(state.database, 'query').mockRestore();
    const factory = jest.spyOn(state.database, 'createQueryRunner');
    factory.mockClear();
    return { ...state, control, factory };
  }
  it('actual DataSource.query creates one fenced business runner with independent control reads and no recursion', async () => {
    const state = await separateControlFixture();
    expect(await state.database.query('SELECT business_value')).toEqual([
      { value: 7 },
    ]);
    expect(state.factory).toHaveBeenCalledTimes(1);
    expect(
      state.sql.mock.calls.filter(([query]) =>
        query.includes('inet_server_addr'),
      ),
    ).toHaveLength(1);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it('refuses changed actual held-runner endpoint before business SQL and still releases the runner', async () => {
    const state = await separateControlFixture(true);
    await expect(
      state.database.query('UPDATE business_value'),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(
      state.sql.mock.calls.some(([query]) => query === 'UPDATE business_value'),
    ).toBe(false);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it('does not admit an unbound business DataSource through an issued control', async () => {
    const state = await separateControlFixture();
    await expect(
      state.control.assertBusinessDatabase(
        new DataSource({ type: 'postgres' }),
        state.checkpoint,
      ),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    await state.runner.release();
  });
  it('the installed pool gate creates one actual runner and executes the original business query without recursive or double fencing', async () => {
    const state = await separateControlFixture(false, false);
    state.database.setOptions({ poolSize: 1 });
    const initialized = jest.replaceProperty(
      state.database,
      'isInitialized',
      true,
    );
    const destroy = jest.spyOn(state.database, 'destroy').mockResolvedValue();
    try {
      const custody = await PrivateNativeStockPoolCustody.bind(
        state.database,
        state.control,
        state.checkpoint,
      );
      expect(await state.database.query('SELECT business_value')).toEqual([
        { value: 7 },
      ]);
      expect(state.factory).toHaveBeenCalledTimes(1);
      expect(
        state.sql.mock.calls.filter(
          ([query]) => query === 'SELECT business_value',
        ),
      ).toHaveLength(1);
      await custody.closeAll();
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(() => state.database.createQueryRunner()).toThrow(
        PrivateNativeActionUnavailable,
      );
    } finally {
      initialized.restore();
      destroy.mockRestore();
    }
  });
  it('withdraws business authority once and still completes owned pool destruction after an initial destroy failure', async () => {
    const state = await separateControlFixture(false, false);
    state.database.setOptions({ poolSize: 1 });
    const initialized = jest.replaceProperty(
      state.database,
      'isInitialized',
      true,
    );
    const primary = new Error('inert first destroy failure');
    const destroy = jest
      .spyOn(state.database, 'destroy')
      .mockRejectedValueOnce(primary)
      .mockResolvedValue();
    try {
      const custody = await PrivateNativeStockPoolCustody.bind(
        state.database,
        state.control,
        state.checkpoint,
      );
      await expect(custody.close(state.database)).rejects.toBe(primary);
      await expect(
        state.control.assertBusinessDatabase(state.database, state.checkpoint),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      await custody.close(state.database);
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(() => state.database.createQueryRunner()).toThrow(
        PrivateNativeActionUnavailable,
      );
    } finally {
      initialized.restore();
      destroy.mockRestore();
    }
  });
  it('refuses a second genuinely issued checkpoint or another pool/control at context assembly', async () => {
    const state = await separateControlFixture(false, false);
    state.database.setOptions({ poolSize: 1 });
    const initialized = jest.replaceProperty(
      state.database,
      'isInitialized',
      true,
    );
    const destroy = jest.spyOn(state.database, 'destroy').mockResolvedValue();
    try {
      const custody = await PrivateNativeStockPoolCustody.bind(
        state.database,
        state.control,
        state.checkpoint,
      );
      readIndex = 0;
      const otherCheckpoint =
        await PrivateNativeStockActionCheckpoint.bindPending(
          await issued(),
          target,
        );
      expect(() =>
        custody.assertBinding(state.database, state.control, state.checkpoint),
      ).not.toThrow();
      expect(() =>
        custody.assertBinding(state.database, state.control, otherCheckpoint),
      ).toThrow(PrivateNativeActionUnavailable);
      expect(() =>
        custody.assertBinding(
          new DataSource({ type: 'postgres' }),
          state.control,
          state.checkpoint,
        ),
      ).toThrow(PrivateNativeActionUnavailable);
      const otherControl = await PrivateNativeStockRoleGuard.bindControl(
        target,
        state.checkpoint,
      );
      expect(() =>
        custody.assertBinding(state.database, otherControl, state.checkpoint),
      ).toThrow(PrivateNativeActionUnavailable);
      await custody.closeAll();
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      initialized.restore();
      destroy.mockRestore();
    }
  });
  it('uses only the connection captured at actual business admission, refusing URL retarget and caller secrets', async () => {
    const state = await separateControlFixture(false, false);
    state.database.setOptions({
      url: 'postgresql://foreign:caller@10.0.0.99:5432/foreign',
    });
    await expect(
      state.control.readBusinessConnectionString(
        state.database,
        state.checkpoint,
      ),
    ).resolves.toBe(
      'postgresql://exe_crm_native_stock_provisioner:fixture-only@10.0.0.2:5432/native',
    );
    state.control.withdrawBusinessDatabase(state.database, state.checkpoint);
    await expect(
      state.control.readBusinessConnectionString(
        state.database,
        state.checkpoint,
      ),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
  });
  it.each([undefined, null, false, 0, ''])(
    'preserves thrown falsy primary %p and attempts parent closure',
    async (primary) => {
      const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
        await issued(),
        target,
      );
      const cleanupError = new Error('inert parent closure refusal');
      const lifecycle = Object.create(
        PrivateNativeStockParentLifecycle.prototype,
      ) as PrivateNativeStockParentLifecycle;
      const pairing = jest
        .spyOn(lifecycle, 'assertCheckpoint')
        .mockImplementation(() => {});
      const close = jest
        .spyOn(lifecycle, 'closeBusiness')
        .mockRejectedValue(cleanupError);
      const bind = jest
        .spyOn(PrivateNativeStockParentLifecycle, 'bind')
        .mockResolvedValue(lifecycle);
      const control = jest
        .spyOn(PrivateNativeStockRoleGuard, 'bindControl')
        .mockImplementation(async () => {
          throw primary;
        });
      try {
        const session = await PrivateNativeStockSetupSession.bind(
          checkpoint,
          target,
          target,
        );
        const error = await session.prepare().catch((value) => value);
        expect(error).toBeInstanceOf(PrivateNativeStockSessionUncertain);
        expect(error.primary).toBe(primary);
        expect(error.cleanupErrors).toEqual([cleanupError]);
        expect(close).toHaveBeenCalledTimes(1);
        await expect(session.prepare()).rejects.toBeInstanceOf(
          PrivateNativeActionUnavailable,
        );
      } finally {
        control.mockRestore();
        bind.mockRestore();
        close.mockRestore();
        pairing.mockRestore();
      }
    },
  );
  it('refuses a manufactured filesystem ledger before invoking caller storage methods', async () => {
    const checkpoint = await PrivateNativeStockActionCheckpoint.bindPending(
      await issued(),
      target,
    );
    const assertCheckpoint = jest.fn();
    const outputReadManifest = jest.fn();
    expect(() =>
      PrivateNativeStockOutputObserver.bind(checkpoint, {
        assertCheckpoint,
        outputReadManifest,
      } as unknown as PrivateNativeStockStorage),
    ).toThrow(PrivateNativeActionUnavailable);
    expect(assertCheckpoint).not.toHaveBeenCalled();
    expect(outputReadManifest).not.toHaveBeenCalled();
  });
});
