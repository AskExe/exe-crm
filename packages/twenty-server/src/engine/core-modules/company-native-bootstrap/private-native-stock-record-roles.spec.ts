import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { v5 } from 'uuid';

import { type ObjectPermissionService } from 'src/engine/metadata-modules/object-permission/object-permission.service';

import { prepareOriginalStockRecordRoles } from './private-native-stock-record-roles';

jest.mock('src/engine/core-modules/application/application.service', () => ({
  ApplicationService: class {},
}));
jest.mock('src/engine/metadata-modules/role/role.service', () => ({
  RoleService: class {},
}));
jest.mock(
  'src/engine/metadata-modules/object-permission/object-permission.service',
  () => ({ ObjectPermissionService: class {} }),
);
jest.mock(
  'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service',
  () => ({ WorkspaceManyOrAllFlatEntityMapsCacheService: class {} }),
);
jest.mock('./private-native-stock-provider-context', () => ({
  assertPrivateStockProviderContext: jest.fn(),
}));
jest.mock('./private-native-stock-action-checkpoint', () => ({
  PrivateNativeStockActionCheckpoint: class {},
}));
jest.mock('./private-native-stock-role-guard', () => ({
  PrivateNativeStockRoleGuard: class {},
}));

// These exercise the actual composition and native-service inputs, not SQL grants.
const actionId = '123e4567-e89b-42d3-a456-426614174000';
const workspaceId = '123e4567-e89b-42d3-a456-426614174001';
function fixture() {
  let revoked = false;
  const checkpoint = {
    pendingPlan: {
      original: { actionId, workspaceId, customApplicationId: 'custom' },
    },
    assertCurrent: jest.fn(async () => {
      if (revoked) throw new Error('revoked');
    }),
  };
  const objects = [STANDARD_OBJECTS.person, STANDARD_OBJECTS.company].map(
    (standard, index) => ({
      id: `object-${index}`,
      universalIdentifier: standard.universalIdentifier,
      nameSingular: ['person', 'company'][index],
      workspaceId,
      applicationId: 'standard',
      isSystem: false,
    }),
  );
  const applications = {
    workspaceCustomFlatApplication: { id: 'custom' },
    twentyStandardFlatApplication: { id: 'standard' },
  };
  const createRole = jest.fn(async ({ input }) => input);
  const updateRole = jest.fn(async ({ input }) => ({
    id: input.id,
    isEditable: input.update.isEditable,
  }));
  const upsertObjectPermissions = jest.fn(
    async (
      _input: Parameters<ObjectPermissionService['upsertObjectPermissions']>[0],
    ) => undefined,
  );
  const cache = jest.fn(async () => ({
    flatObjectMetadataMaps: {
      byUniversalIdentifier: Object.fromEntries(
        objects.map((object) => [object.universalIdentifier, object]),
      ),
    },
  }));
  const context = {
    get: (token: { name: string }) =>
      ({
        ApplicationService: {
          findWorkspaceTwentyStandardAndCustomApplicationOrThrow: async () =>
            applications,
        },
        RoleService: { createRole, updateRole },
        ObjectPermissionService: { upsertObjectPermissions },
        WorkspaceManyOrAllFlatEntityMapsCacheService: {
          getOrRecomputeManyOrAllFlatEntityMaps: cache,
        },
      })[token.name],
  };
  const control = { assertBusinessDatabase: jest.fn(async () => undefined) };
  const invoke = () =>
    prepareOriginalStockRecordRoles(
      checkpoint as unknown as Parameters<
        typeof prepareOriginalStockRecordRoles
      >[0],
      {} as Parameters<typeof prepareOriginalStockRecordRoles>[1],
      control as unknown as Parameters<
        typeof prepareOriginalStockRecordRoles
      >[2],
      context as unknown as Parameters<
        typeof prepareOriginalStockRecordRoles
      >[3],
    );
  return {
    invoke,
    objects,
    applications,
    checkpoint,
    createRole,
    updateRole,
    upsertObjectPermissions,
    cache,
    revoke: () => {
      revoked = true;
    },
  };
}
describe('stock constrained cold roles', () => {
  it('creates only two action-derived locked roles and native Person/Company permission rows', async () => {
    const state = fixture();
    await state.invoke();
    expect(state.createRole).toHaveBeenCalledTimes(2);
    for (const [index, kind] of ['reader', 'writer'].entries()) {
      const input = state.createRole.mock.calls[index][0].input;
      expect(input.id).toBe(
        v5(`private-native-stock-record-${kind}-role-v1`, actionId),
      );
      expect(input).toMatchObject({
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canUpdateAllSettings: false,
        canAccessAllTools: false,
      });
      expect(
        state.upsertObjectPermissions.mock.calls[index][0].input
          .objectPermissions,
      ).toEqual(
        ['object-0', 'object-1'].map((objectMetadataId) => ({
          objectMetadataId,
          canReadObjectRecords: true,
          canUpdateObjectRecords: kind === 'writer',
          canSoftDeleteObjectRecords: false,
          canDestroyObjectRecords: false,
        })),
      );
      expect(state.updateRole.mock.calls[index][0].input).toEqual({
        id: input.id,
        update: { isEditable: false },
      });
    }
  });
  it.each(['workspaceId', 'applicationId', 'nameSingular'] as const)(
    'refuses foreign %s before creating any role',
    async (key) => {
      const state = fixture();
      state.objects[0][key] = 'foreign';
      await expect(state.invoke()).rejects.toThrow();
      expect(state.createRole).not.toHaveBeenCalled();
    },
  );
  it('refuses system metadata and mismatched original custom application', async () => {
    const state = fixture();
    state.objects[0].isSystem = true;
    await expect(state.invoke()).rejects.toThrow();
    expect(state.createRole).not.toHaveBeenCalled();
    const other = fixture();
    other.applications.workspaceCustomFlatApplication.id = 'foreign';
    await expect(other.invoke()).rejects.toThrow();
    expect(other.createRole).not.toHaveBeenCalled();
  });
  it('stops after revoked permission save without locking or issuing another role', async () => {
    const state = fixture();
    state.upsertObjectPermissions.mockImplementation(async () => {
      state.revoke();
    });
    await expect(state.invoke()).rejects.toThrow('revoked');
    expect(state.createRole).toHaveBeenCalledTimes(1);
    expect(state.updateRole).not.toHaveBeenCalled();
  });
  it('refuses a returned foreign role before permission writes', async () => {
    const state = fixture();
    state.createRole.mockImplementation(async ({ input }) => ({
      ...input,
      id: 'foreign',
    }));
    await expect(state.invoke()).rejects.toThrow();
    expect(state.upsertObjectPermissions).not.toHaveBeenCalled();
    expect(state.updateRole).not.toHaveBeenCalled();
  });
  it('propagates native permission errors without locking partial roles', async () => {
    const state = fixture();
    const failure = new Error('native_permission_failure');
    state.upsertObjectPermissions.mockRejectedValue(failure);
    await expect(state.invoke()).rejects.toBe(failure);
    expect(state.createRole).toHaveBeenCalledTimes(1);
    expect(state.updateRole).not.toHaveBeenCalled();
  });
  it('refuses revocation during asynchronous metadata read before role writes', async () => {
    const state = fixture();
    state.cache.mockImplementation(async () => {
      state.revoke();
      return { flatObjectMetadataMaps: { byUniversalIdentifier: {} } };
    });
    await expect(state.invoke()).rejects.toThrow('revoked');
    expect(state.createRole).not.toHaveBeenCalled();
  });
});
