import { companyEditorContextDigest } from '../company-editor.csrf';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  OnboardingStepKeys,
  type OnboardingKeyValueTypeMap,
} from 'src/engine/core-modules/onboarding/onboarding.service';
import { type UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
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
let mockEditorEnabled = false;
jest.mock('../company-editor.config', () => ({
  companyEditorEnabled: () => mockEditorEnabled,
}));
jest.mock('../company-browser.config', () => ({
  readCompanyBrowserConfiguration: () => null,
}));
const userVars = { getAll: jest.fn() };
const userVarsService = () =>
  userVars as unknown as UserVarsService<OnboardingKeyValueTypeMap>;

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
  mockEditorEnabled = false;
  userVars.getAll.mockResolvedValue(new Map());
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
    userVarsService(),
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
    userVarsService(),
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

const editorNativeSetup = (writer = false) => {
  mockEditorEnabled = true;
  readConfig.mockReturnValue({
    ...readConfig(),
    nativeSchema: 'workspace_fixture',
  });
  const { subscription_entitled: _ignored, ...base } = envelope;
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          ...base,
          version: 2,
          access_entitled: true,
          entitlement_kind: 'beta',
          scopes: writer ? ['crm:read', 'crm:write'] : ['crm:read'],
        }),
        { status: 200 },
      ),
  );
  const date = new Date('2026-10-08T00:00:00Z');
  const entity = {
    id: uuid,
    createdAt: date,
    updatedAt: date,
    deletedAt: null,
  };
  repository.findOne
    .mockReset()
    .mockResolvedValueOnce({
      ...entity,
      activationStatus: 'ACTIVE',
      databaseSchema: 'workspace_fixture',
      suspendedAt: null,
    })
    .mockResolvedValueOnce({
      ...entity,
      isEmailVerified: true,
      disabled: false,
    })
    .mockResolvedValueOnce({ ...entity, userId: uuid, workspaceId: uuid })
    .mockResolvedValueOnce({ roleId: uuid, role: { workspaceId: uuid } });
  const member = {
    ...entity,
    userId: uuid,
    colorScheme: 'Light',
    locale: 'en',
    timeZone: 'UTC',
    dateFormat: 'SYSTEM',
    timeFormat: 'SYSTEM',
    numberFormat: 'SYSTEM',
    avatarUrl: null,
    userEmail: null,
    searchVector: null,
    nameFirstName: 'Owned',
    nameLastName: 'Editor',
    position: 1,
    calendarStartDay: 1,
  };
  const builder = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    getRawOne: jest.fn(async () => member),
  };
  builder.select.mockReturnValue(builder);
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  dataSource.createQueryBuilder.mockReturnValue(builder);
  cache.getOrRecompute.mockResolvedValue({
    userWorkspaceRoleMap: { [uuid]: uuid },
  });
  return {
    current: service(),
    request: {
      headers: { cookie: '__Host-exe_crm_session=exs_' + 'A'.repeat(43) },
    } as Request,
    builder,
  };
};
it('admits completed native editor onboarding using only the original bound identity', async () => {
  const { current, request } = editorNativeSetup();
  await expect(current.authenticate(request)).resolves.toMatchObject({
    userWorkspaceId: uuid,
  });
  expect(userVars.getAll).toHaveBeenCalledWith({
    userId: uuid,
    workspaceId: uuid,
  });
});
it.each(Object.values(OnboardingStepKeys))(
  'refuses native editor bootstrap while %s remains pending',
  async (key) => {
    const { current, request, builder } = editorNativeSetup();
    userVars.getAll.mockResolvedValue(new Map([[key, true]]));
    await expect(current.authenticate(request)).rejects.toMatchObject({
      status: 401,
    });
    expect(builder.getRawOne).not.toHaveBeenCalled();
  },
);
it('refuses cancellation during the native onboarding read before exposing the member', async () => {
  const { current, request, builder } = editorNativeSetup();
  const controller = new AbortController();
  userVars.getAll.mockImplementation(async () => {
    controller.abort();
    return new Map();
  });
  await expect(
    current.authenticate(request, controller.signal),
  ).rejects.toMatchObject({ status: 503 });
  expect(builder.getRawOne).not.toHaveBeenCalled();
});

it.each([
  'original',
  'foreign-workspace',
  'foreign-member',
  'fingerprint-drift',
  'reader-grant',
])(
  'uses the actual request fence and captured native actor identity: %s',
  async (mode) => {
    const { current, request } = editorNativeSetup(mode !== 'reader-grant');
    const prepared = await current.currentRead(
      request,
      new AbortController().signal,
    );
    const authority = current.editorAuthority(request)!;
    request.headers['x-exe-company-context'] =
      companyEditorContextDigest(authority);
    const read = jest.spyOn(current, 'currentRead').mockResolvedValue(prepared);
    jest
      .spyOn(current, 'assertEditorWrite')
      .mockResolvedValue({
        context: prepared.context,
        authority,
        contextDigest: companyEditorContextDigest(authority),
      });
    const auth = {
      ...prepared.context,
      type: 'user',
    } as UserWorkspaceAuthContext;
    const operation = new Promise<void>((resolve, reject) => {
      void current
        .withEditorRequest(request, () => {
          if (mode === 'fingerprint-drift')
            read.mockResolvedValue({ ...prepared, fingerprint: 'changed' });
          const supplied =
            mode === 'foreign-workspace'
              ? { ...auth, workspace: { ...auth.workspace, id: 'foreign' } }
              : mode === 'foreign-member'
                ? { ...auth, workspaceMemberId: 'foreign' }
                : auth;
          void current.assertEditorActor(supplied).then(resolve, reject);
        })
        .catch(reject);
    });
    if (mode === 'original') await expect(operation).resolves.toBeUndefined();
    else await expect(operation).rejects.toMatchObject({ status: 401 });
  },
);
