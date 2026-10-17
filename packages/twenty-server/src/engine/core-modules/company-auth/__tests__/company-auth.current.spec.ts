import { type DiscoveryService, type Reflector } from '@nestjs/core';
import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { WorkspaceCacheProvider } from 'src/engine/workspace-cache/interfaces/workspace-cache-provider.service';
import { WORKSPACE_CACHE_KEY } from 'src/engine/workspace-cache/decorators/workspace-cache.decorator';
import {
  type WorkspaceCacheDataMap,
  type WorkspaceCacheKeyName,
} from 'src/engine/workspace-cache/types/workspace-cache-key.type';
import { RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { type Request } from 'express';
import { type DataSource } from 'typeorm';

import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { CompanyAuthService } from '../company-auth.service';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const readConfig = jest.fn();

jest.mock('../company-auth.config', () => ({
  ...jest.requireActual('../company-auth.config'),
  readCompanyAuthConfiguration: () => readConfig(),
}));
const originalFetch = global.fetch;
const envelope = {
  version: 1,
  subject_id: uuid,
  company_id: uuid,
  product: 'crm',
  resource_kind: 'crm-workspace',
  binding_id: uuid,
  native_id: uuid,
  generation_id: uuid,
  authz_epoch: '1',
  audience: 'crm-alpha',
  scopes: ['crm:read'],
  current_role: 'owner',
  technical_status: 'accepted',
  subscription_entitled: true,
};
const repository = { findOne: jest.fn() };
const dataSource = {
  getRepository: jest.fn(() => repository),
  createQueryBuilder: jest.fn(),
};
const cache = { invalidateAndRecompute: jest.fn(), getOrRecompute: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  readConfig.mockReturnValue({
    companyId: uuid,
    workspaceId: uuid,
    bindingId: uuid,
    generationId: uuid,
    audience: 'crm-alpha',
    clientId: 'crm-alpha',
    clientSecret: 'private-fixture-secret',
    brokerUrl: 'http://broker:8092',
    authorityUrl: 'http://authority:8095',
    bindings: new Map([
      [
        uuid,
        {
          subject_id: uuid,
          user_id: uuid,
          user_workspace_id: uuid,
          workspace_member_id: uuid,
        },
      ],
    ]),
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});
const service = () =>
  new CompanyAuthService(
    dataSource as unknown as DataSource,
    cache as unknown as WorkspaceCacheService,
  );
const request = {
  headers: { authorization: 'Bearer exk_' + 'A'.repeat(43) },
} as Request;

it('looks up current native membership after blocked central verification and denies a removed native user', async () => {
  let release: (value: Response) => void = () => {};

  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const current = service().authenticate(request);

  expect(repository.findOne).not.toHaveBeenCalled();
  repository.findOne.mockResolvedValue(null);
  release(new Response(JSON.stringify(envelope), { status: 200 }));
  await expect(current).rejects.toMatchObject({ status: 401 });
  expect(repository.findOne).toHaveBeenCalled();
  expect(cache.invalidateAndRecompute).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 404, 503])(
  'does not touch native identity or cached ACL after authority status %s',
  async (status) => {
    global.fetch = jest.fn(
      async () => new Response('{"error":"unavailable"}', { status }),
    );
    await expect(service().authenticate(request)).rejects.toMatchObject({
      status:
        status === 400 ? 400 : status === 401 || status === 403 ? 401 : 503,
    });
    expect(repository.findOne).not.toHaveBeenCalled();
  },
);
it('uses a fixed native client and no caller actor/workspace selectors in private introspection', async () => {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          ...envelope,
          company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
        { status: 200 },
      ),
  );
  await expect(service().authenticate(request)).rejects.toMatchObject({
    status: 401,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    'http://authority:8095/internal/company-authority/key-introspect',
    expect.objectContaining({
      redirect: 'error',
      body: JSON.stringify({ api_key: 'exk_' + 'A'.repeat(43) }),
      headers: expect.objectContaining({
        Authorization:
          'Basic ' +
          Buffer.from('crm-alpha:private-fixture-secret').toString('base64'),
      }),
    }),
  );
  expect(repository.findOne).not.toHaveBeenCalled();
});

const permissionKeys = [
  'rolesPermissions',
  'userWorkspaceRoleMap',
  'flatRowLevelPermissionPredicateMaps',
  'flatRowLevelPermissionPredicateGroupMaps',
  'flatFieldMetadataMaps',
] satisfies WorkspaceCacheKeyName[];
const snapshotContext = () => ({
  workspace: { id: uuid },
  user: { id: uuid },
  userWorkspaceId: uuid,
  workspaceMemberId: uuid,
  workspaceMember: { id: uuid, name: { firstName: 'Member', lastName: 'A' } },
  userWorkspace: {
    id: uuid,
    locale: 'en',
    createdAt: '2026-10-04T00:00:00.000Z',
  },
});
const snapshotPermissions = () => ({
  rolesPermissions: {
    role: {
      object: { canRead: true, restrictedFields: { field: { canRead: true } } },
    },
  },
  userWorkspaceRoleMap: { member: 'role' },
  flatRowLevelPermissionPredicateMaps: {
    byId: { row: { operand: 'A', values: ['A', 'B'] } },
  },
  flatRowLevelPermissionPredicateGroupMaps: {
    byId: { group: { logicalOperator: 'AND' } },
  },
  flatFieldMetadataMaps: {
    byId: { field: { label: 'Name', updatedAt: '2026-10-04T00:00:00.000Z' } },
  },
});
// Real cache method and provider discovery; only native provider results are controlled.
class DeferredProvider extends WorkspaceCacheProvider {
  resolve: (value: WorkspaceCacheDataMap[WorkspaceCacheKeyName]) => void =
    () => {};
  readonly computeForCache = jest.fn(
    () =>
      new Promise<WorkspaceCacheDataMap[WorkspaceCacheKeyName]>((resolve) => {
        this.resolve = resolve;
      }),
  );
  constructor(readonly key: WorkspaceCacheKeyName) {
    super();
  }
}
const orderedCache = async (data: unknown, reversed: boolean) => {
  const originalMode = process.env.CRM_COMPANY_MODE;
  process.env.CRM_COMPANY_MODE = 'true';
  try {
    const providers = permissionKeys.map((key) => new DeferredProvider(key));
    const storage = { mget: jest.fn(), mset: jest.fn() };
    const nativeCache = new WorkspaceCacheService(
      storage as unknown as CacheStorageService,
      {
        getProviders: () => providers.map((instance) => ({ instance })),
      } as unknown as DiscoveryService,
      {
        get: (key: string, constructor: unknown) =>
          key === WORKSPACE_CACHE_KEY
            ? providers.find((provider) => provider.constructor === constructor)
                ?.key
            : undefined,
      } as unknown as Reflector,
    );
    // Each provider is a real distinct discovered class, just as native providers are.
    for (const provider of providers)
      Object.defineProperty(provider, 'constructor', { value: class {} });
    await nativeCache.onModuleInit();
    const pending = nativeCache.getOrRecompute(uuid, permissionKeys);
    for (const provider of providers)
      expect(provider.computeForCache).toHaveBeenCalledWith(uuid);
    for (const provider of reversed ? [...providers].reverse() : providers) {
      provider.resolve((data as WorkspaceCacheDataMap)[provider.key]);
      await Promise.resolve();
    }
    const result = await pending;
    expect(Object.keys(result)).toEqual(permissionKeys);
    for (const key of permissionKeys)
      expect(result[key]).toBe((data as WorkspaceCacheDataMap)[key]);
    for (const provider of providers)
      expect(provider.computeForCache).toHaveBeenCalledTimes(1);
    expect(storage.mget).not.toHaveBeenCalled();
    expect(storage.mset).not.toHaveBeenCalled();
    return { nativeCache, result };
  } finally {
    if (originalMode === undefined) delete process.env.CRM_COMPANY_MODE;
    else process.env.CRM_COMPANY_MODE = originalMode;
  }
};
const fingerprintFromCache = async (
  data: unknown,
  reversed = false,
  context = snapshotContext(),
) => {
  const { nativeCache, result } = await orderedCache(data, reversed);
  // Feed the exact result returned by actual company-mode getOrRecompute into
  // currentRead without issuing a second deferred provider dispatch.
  jest
    .spyOn(nativeCache, 'getOrRecompute')
    .mockResolvedValue(result as WorkspaceCacheDataMap);
  const current = new CompanyAuthService(
    dataSource as unknown as DataSource,
    nativeCache,
  );
  jest
    .spyOn(current, 'authenticate')
    .mockResolvedValue(
      context as Awaited<ReturnType<CompanyAuthService['authenticate']>>,
    );
  return (await current.currentRead(request, new AbortController().signal))
    .fingerprint;
};
it('keeps requested cache order and actual currentRead fingerprint stable for opposite provider completion orders', async () => {
  const data = snapshotPermissions();
  expect(await fingerprintFromCache(data)).toBe(
    await fingerprintFromCache(data, true),
  );
});
it.each(['field', 'row', 'object', 'member', 'role'] as const)(
  'retains actual %s value changes in the fingerprint',
  async (kind) => {
    const context = snapshotContext();
    const data = snapshotPermissions();
    const before = await fingerprintFromCache(data, false, context);
    if (kind === 'field')
      data.flatFieldMetadataMaps.byId.field.label = 'Changed';
    if (kind === 'row')
      data.flatRowLevelPermissionPredicateMaps.byId.row.operand = 'B';
    if (kind === 'object') data.rolesPermissions.role.object.canRead = false;
    if (kind === 'member') context.workspaceMember.name.firstName = 'Changed';
    if (kind === 'role') data.userWorkspaceRoleMap.member = 'other-role';
    expect(await fingerprintFromCache(data, true, context)).not.toBe(before);
  },
);
it('preserves permission array order as significant', async () => {
  const data = snapshotPermissions();
  const before = await fingerprintFromCache(data);
  data.flatRowLevelPermissionPredicateMaps.byId.row.values.reverse();
  expect(await fingerprintFromCache(data, true)).not.toBe(before);
});
it('preserves known native predicate classes and Date payloads without projection', async () => {
  const predicate = Object.assign(new RowLevelPermissionPredicateEntity(), {
    id: uuid,
    createdAt: new Date('2026-10-04T00:00:00.000Z'),
    updatedAt: new Date('2026-10-04T00:00:00.000Z'),
    deletedAt: null,
  });
  const group = Object.assign(new RowLevelPermissionPredicateGroupEntity(), {
    id: uuid,
    createdAt: new Date('2026-10-04T00:00:00.000Z'),
    updatedAt: new Date('2026-10-04T00:00:00.000Z'),
    deletedAt: null,
  });
  const data = {
    ...snapshotPermissions(),
    rolesPermissions: {
      role: {
        object: {
          canRead: true,
          rowLevelPermissionPredicates: [predicate],
          rowLevelPermissionPredicateGroups: [group],
        },
      },
    },
    flatFieldMetadataMaps: {
      byId: { field: { deletedAt: new Date('2026-10-04T00:00:00.000Z') } },
    },
  };
  const before = await fingerprintFromCache(data);
  expect(await fingerprintFromCache(data, true)).toBe(before);
  expect(
    data.rolesPermissions.role.object.rowLevelPermissionPredicates[0],
  ).toBe(predicate);
  expect(predicate.createdAt).toBeInstanceOf(Date);
});
it('documents that nested object insertion order remains significant', async () => {
  const data = snapshotPermissions();
  const before = await fingerprintFromCache(data);
  const object = data.rolesPermissions.role.object;
  data.rolesPermissions.role.object = {
    restrictedFields: object.restrictedFields,
    canRead: object.canRead,
  };
  expect(await fingerprintFromCache(data, true)).not.toBe(before);
});
