import { performance } from 'node:perf_hooks';

import { FileFolder } from 'twenty-shared/types';
import { type DataSource, type QueryRunner } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import {
  PrivateNativeActionReader,
  type PrivateNativeActionTuple,
  PrivateNativeActionUnavailable,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { LocalDriver } from 'src/engine/core-modules/file-storage/drivers/local.driver';
import { ValidatedStorageDriver } from 'src/engine/core-modules/file-storage/drivers/validated-storage.driver';
import { writeTransactionalApplicationFile } from 'src/engine/core-modules/file-storage/write-transactional-application-file';

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

// Actual fence/helper methods, synthetic SQL/repositories and a spied local
// driver. These controls perform no native database or filesystem allocation.
describe('transactional private package-file boundaries', () => {
  let clock = 1000;
  const owner = '88888888-8888-4888-8888-888888888888';
  const coreQuery = jest.fn();
  const markerQuery = jest.fn();
  const applicationFind = jest.fn();
  const fileUpsert = jest.fn();
  const fileInsert = jest.fn();
  const fileFind = jest.fn();
  const params = {
    workspaceId: tuple.company_id,
    applicationUniversalIdentifier: tuple.intent_id,
    fileFolder: FileFolder.Dependencies,
    resourcePath: 'package.json',
    sourceFile: '{}',
    mimeType: undefined,
    settings: { isTemporaryFile: false, toDelete: false },
  };
  const runner = {
    manager: {
      getRepository: (entity: unknown) =>
        entity === ApplicationEntity
          ? { findOneOrFail: applicationFind }
          : { insert: fileInsert, upsert: fileUpsert, findOneOrFail: fileFind },
    },
  } as unknown as QueryRunner;
  const driver = new ValidatedStorageDriver(
    new LocalDriver({ storagePath: '/held-owned-local' }),
  );

  function projection() {
    const { lease_token: _secret, ...bound } = tuple;
    return {
      ...bound,
      owner_subject: owner,
      sql_time: '2026-10-05T12:00:00+00:00',
      lease_expires_at: '2026-10-05T14:00:00+00:00',
    };
  }

  function nativeRows(sql: string) {
    if (sql.includes('FROM pg_roles r WHERE r.rolname=session_user'))
      return [
        {
          login: 'owned_native_writer',
          effective: 'owned_native_writer',
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
    if (sql.includes('WHERE p.oid=to_regprocedure'))
      return [
        {
          oid: '12345',
          body_matches: true,
          owner_matches: true,
          public_denied: true,
          executable: true,
        },
      ];
    if (sql.includes('AS schema_authority'))
      return [
        {
          schema_authority: false,
          object_authority: false,
          routine_authority: false,
          type_authority: false,
          column_authority: false,
        },
      ];
    return [{ actionId: tuple.action_id }];
  }

  async function fence() {
    return PrivateNativeMutationFence.bindCommittedMarker(
      { query: markerQuery } as unknown as DataSource,
      new PrivateNativeActionReader(
        { query: coreQuery } as unknown as DataSource,
        true,
      ),
      tuple,
      owner,
      11000,
      601000,
      60000,
      'owned_native_writer',
    );
  }

  beforeEach(() => {
    clock = 1000;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    jest.spyOn(LocalDriver.prototype, 'writeFile').mockResolvedValue();
    coreQuery.mockReset().mockResolvedValue([{ authority: projection() }]);
    markerQuery
      .mockReset()
      .mockImplementation(async (sql: string) => nativeRows(sql));
    applicationFind.mockReset().mockResolvedValue({ id: tuple.intent_id });
    fileUpsert.mockReset().mockResolvedValue(undefined);
    fileInsert.mockReset().mockResolvedValue(undefined);
    fileFind.mockReset().mockResolvedValue({ id: tuple.request_key });
  });
  afterEach(() => jest.restoreAllMocks());

  it('retains ordinary lookup/write/upsert/read behavior without a private fence', async () => {
    await writeTransactionalApplicationFile(driver, runner, params);
    expect(coreQuery).not.toHaveBeenCalled();
    expect(LocalDriver.prototype.writeFile).toHaveBeenCalledTimes(1);
    expect(fileUpsert).toHaveBeenCalledTimes(1);
    expect(fileFind).toHaveBeenCalledTimes(1);
  });

  it('writes only after actual SQL-owned fence and committed marker reads', async () => {
    const bound = await fence();
    await writeTransactionalApplicationFile(driver, runner, params, bound);
    expect(
      markerQuery.mock.calls.filter((call) =>
        String(call[0]).startsWith('SELECT "actionId"'),
      ),
    ).toHaveLength(1);
    expect(
      coreQuery.mock.calls.every((call) =>
        String(call[0]).includes('core.read_native_action_owner'),
      ),
    ).toBe(true);
    expect(LocalDriver.prototype.writeFile).toHaveBeenCalledTimes(1);
  });

  it('uses only a fresh INSERT for private file identity keys', async () => {
    const bound = await fence();
    await writeTransactionalApplicationFile(driver, runner, params, bound);
    expect(fileInsert).toHaveBeenCalledTimes(1);
    expect(fileInsert).toHaveBeenCalledWith({
      path: `${params.fileFolder}/${params.resourcePath}`,
      workspaceId: params.workspaceId,
      applicationId: tuple.intent_id,
      id: undefined,
      mimeType: undefined,
      size: Buffer.byteLength(params.sourceFile),
      settings: params.settings,
    });
    expect(fileUpsert).not.toHaveBeenCalled();
    expect(fileFind).toHaveBeenCalledTimes(1);
  });

  it.each(['duplicate', 'uncertain'])(
    'preserves a %s private INSERT refusal without adoption or marker mutation',
    async (kind) => {
      const bound = await fence();
      const original = Object.assign(new Error('controlled INSERT refusal'), {
        code: kind === 'duplicate' ? '23505' : '08006',
      });
      fileInsert.mockRejectedValue(original);
      await expect(
        writeTransactionalApplicationFile(driver, runner, params, bound),
      ).rejects.toBe(original);
      expect(fileInsert).toHaveBeenCalledTimes(1);
      expect(fileUpsert).not.toHaveBeenCalled();
      expect(fileFind).not.toHaveBeenCalled();
      expect(LocalDriver.prototype.writeFile).toHaveBeenCalledTimes(1);
      expect(
        markerQuery.mock.calls.every((call) =>
          String(call[0]).startsWith('SELECT'),
        ),
      ).toBe(true);
    },
  );

  it('refuses marker absence without a native file write', async () => {
    markerQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT "actionId"') ? [] : nativeRows(sql),
    );
    await expect(fence()).rejects.toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
  });

  it('refuses expiry during native lookup before the external file write', async () => {
    const bound = await fence();
    applicationFind.mockImplementation(async () => {
      clock = 12000;
      return { id: tuple.intent_id };
    });
    await expect(
      writeTransactionalApplicationFile(driver, runner, params, bound),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
  });

  it('cannot extend the original deadline with a later renewed SQL lease', async () => {
    const bound = await fence();
    coreQuery.mockImplementation(async () => {
      clock = 12000;
      return [{ authority: projection() }];
    });
    await expect(
      writeTransactionalApplicationFile(driver, runner, params, bound),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
  });

  it('refuses a shortened current lease before file write despite the original long lease', async () => {
    const bound = await fence();
    coreQuery.mockResolvedValue([
      {
        authority: {
          ...projection(),
          lease_expires_at: '2026-10-05T12:00:30+00:00',
        },
      },
    ]);
    await expect(
      writeTransactionalApplicationFile(driver, runner, params, bound),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
    expect(fileUpsert).not.toHaveBeenCalled();
  });

  it('preserves a changed SQL privilege refusal before file mutation', async () => {
    const bound = await fence();
    const original = Object.assign(new Error('controlled permission refusal'), {
      code: '23505',
    });
    coreQuery.mockRejectedValue(original);
    await expect(
      writeTransactionalApplicationFile(driver, runner, params, bound),
    ).rejects.toBe(original);
    expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    'schema_authority',
    'object_authority',
    'routine_authority',
    'column_authority',
  ])(
    'refuses native %s broadening after startup before external mutation',
    async (key) => {
      const bound = await fence();
      markerQuery.mockImplementation(async (sql: string) => {
        const rows = nativeRows(sql);
        return sql.includes('AS schema_authority')
          ? [{ ...rows[0], [key]: true }]
          : rows;
      });
      await expect(
        writeTransactionalApplicationFile(driver, runner, params, bound),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(LocalDriver.prototype.writeFile).not.toHaveBeenCalled();
      expect(fileUpsert).not.toHaveBeenCalled();
    },
  );

  it('keeps a failed external write uncertain without upsert, deletion or retry', async () => {
    const bound = await fence();
    const original = new Error('controlled ambiguous file response');
    jest.mocked(LocalDriver.prototype.writeFile).mockRejectedValue(original);
    await expect(
      writeTransactionalApplicationFile(driver, runner, params, bound),
    ).rejects.toBe(original);
    expect(LocalDriver.prototype.writeFile).toHaveBeenCalledTimes(1);
    expect(fileUpsert).not.toHaveBeenCalled();
    expect(
      markerQuery.mock.calls.every((call) =>
        String(call[0]).startsWith('SELECT'),
      ),
    ).toBe(true);
  });
});
