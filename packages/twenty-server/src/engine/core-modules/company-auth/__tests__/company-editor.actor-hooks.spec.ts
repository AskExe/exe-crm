import { type Module } from '@nestjs/core/injector/module';
import { type ModuleRef, type DiscoveryService } from '@nestjs/core';
import { FieldActorSource, FieldMetadataType } from 'twenty-shared/types';
import { ActorFromAuthContextService } from 'src/engine/core-modules/actor/services/actor-from-auth-context.service';
import { CreatedByCreateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-one.pre-query-hook';
import { CreatedByCreateManyPreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-many.pre-query-hook';
import { UpdatedByUpdateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-one.pre-query-hook';
import { UpdatedByUpdateManyPreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-many.pre-query-hook';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { WorkspaceQueryHookStorage } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/storage/workspace-query-hook.storage';
import { WorkspaceQueryHookService } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.service';
import { WorkspaceQueryHookExplorer } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.explorer';
import { type WorkspaceQueryHookMetadataAccessor } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook-metadata.accessor';
import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type CompanyAuthService } from '../company-auth.service';
let mockEditor = true;
let mockCompany = true;
jest.mock('../company-editor.config', () => ({
  companyEditorEnabled: () => mockEditor,
}));
jest.mock('../company-auth.config', () => ({
  companyAuthEnabled: () => mockCompany,
}));
const auth = {
  type: 'user',
  workspace: { id: 'workspace' },
  user: { id: 'user' },
  userWorkspaceId: 'uw',
  workspaceMemberId: 'member',
  workspaceMember: {
    id: 'member',
    name: { firstName: 'Real', lastName: 'Owner' },
  },
} as UserWorkspaceAuthContext;
const actor = {
  workspaceMemberId: 'member',
  source: FieldActorSource.MANUAL,
  name: 'Real Owner',
  context: {},
};
const spoof = {
  workspaceMemberId: 'foreign',
  source: 'API',
  name: 'Forged',
  context: { foreign: true },
};
const maps = {
  flatObjectMetadataMaps: {
    universalIdentifierById: { person: 'person' },
    byUniversalIdentifier: {
      person: {
        id: 'person',
        nameSingular: 'person',
        namePlural: 'people',
        fieldIds: ['createdBy', 'updatedBy'],
      },
    },
  },
  flatFieldMetadataMaps: {
    universalIdentifierById: { createdBy: 'createdBy', updatedBy: 'updatedBy' },
    byUniversalIdentifier: {
      createdBy: {
        id: 'createdBy',
        name: 'createdBy',
        type: FieldMetadataType.ACTOR,
      },
      updatedBy: {
        id: 'updatedBy',
        name: 'updatedBy',
        type: FieldMetadataType.ACTOR,
      },
    },
  },
};
function setup() {
  mockEditor = true;
  mockCompany = true;
  const storage = new WorkspaceQueryHookStorage();
  const read = jest.fn(async () => maps);
  const native = new ActorFromAuthContextService({
    getOrRecomputeManyOrAllFlatEntityMaps: read,
  } as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService);
  const hooks = {
    createOne: new CreatedByCreateOnePreQueryHook(native),
    createMany: new CreatedByCreateManyPreQueryHook(native),
    updateOne: new UpdatedByUpdateOnePreQueryHook(native),
    updateMany: new UpdatedByUpdateManyPreQueryHook(native),
  };
  const fence = jest.fn(async (context) => {
    expect(context).toBe(auth);
  });
  const explorer = new WorkspaceQueryHookExplorer(
    {} as ModuleRef,
    {} as DiscoveryService,
    {} as WorkspaceQueryHookMetadataAccessor,
    storage,
  );
  const execute = jest.spyOn(explorer, 'handlePreHook');
  const service = new WorkspaceQueryHookService(storage, explorer, {
    assertEditorActor: fence,
  } as unknown as CompanyAuthService);
  function register(
    method: keyof typeof hooks,
    instance: WorkspacePreQueryHookInstance = hooks[method],
    key = `*.${method}`,
    requestScoped = false,
  ) {
    storage.registerWorkspaceQueryPreHookInstance(key as `*.${typeof method}`, {
      instance,
      host: {} as Module,
      isRequestScoped: requestScoped,
    });
  }
  return { storage, read, hooks, fence, execute, service, register };
}
it.each(['createOne', 'createMany', 'updateOne', 'updateMany'] as const)(
  'runs native %s actor output and sanitizes the merge destination',
  async (method) => {
    const x = setup();
    x.register(method);
    const record = { name: 'Business', createdBy: spoof, updatedBy: spoof };
    const data =
      method === 'createMany'
        ? [record, { ...record, name: 'Second' }]
        : record;
    const output = await x.service.executePreQueryHooks(
      auth,
      'person',
      method,
      { data },
    );
    for (const row of Array.isArray(output.data)
      ? output.data
      : [output.data]) {
      expect(row.name).toBeDefined();
      expect(row.updatedBy).toEqual(actor);
      if (method.startsWith('create')) expect(row.createdBy).toEqual(actor);
      else expect(row.createdBy).toBeUndefined();
    }
    expect(record.createdBy).toEqual(spoof);
    expect(x.fence).toHaveBeenCalledTimes(2);
    expect(x.execute).toHaveBeenCalledTimes(1);
  },
);
it.each([
  'unknown',
  'specific',
  'tampered',
  'scoped',
  'post',
  'foreign',
  'missing',
] as const)('refuses whole hook set before execution: %s', async (mode) => {
  const x = setup();
  if (mode === 'unknown')
    x.register('createOne', { execute: async (_a, _o, p) => p });
  else if (mode === 'specific')
    x.register('createOne', x.hooks.createOne, 'person.createOne');
  else if (mode === 'tampered') {
    x.hooks.createOne.execute = jest.fn();
    x.register('createOne');
  } else if (mode === 'scoped')
    x.register('createOne', x.hooks.createOne, '*.createOne', true);
  else if (mode !== 'missing') x.register('createOne');
  if (mode === 'post')
    x.storage.registerWorkspacePostQueryHookInstance('person.createOne', {
      instance: { execute: jest.fn() },
      host: {} as Module,
      isRequestScoped: false,
    });
  await expect(
    x.service.executePreQueryHooks(
      auth,
      mode === 'foreign' ? 'workspaceMember' : 'person',
      'createOne',
      { data: { name: 'Business' } },
    ),
  ).rejects.toThrow();
  expect(x.execute).not.toHaveBeenCalled();
  expect(x.read).not.toHaveBeenCalled();
});
it.each(['grant', 'context', 'cancellation'])(
  'does not publish hook output after %s changes during native async metadata read',
  async (mode) => {
    const x = setup();
    x.register('createOne');
    let changed = false;
    x.read.mockImplementation(async () => {
      changed = true;
      return maps;
    });
    x.fence.mockImplementation(async () => {
      if (changed) throw new Error(mode);
    });
    await expect(
      x.service.executePreQueryHooks(auth, 'person', 'createOne', {
        data: { name: 'Business', createdBy: spoof },
      }),
    ).rejects.toThrow(mode);
    expect(x.fence).toHaveBeenCalledTimes(2);
  },
);
it('preserves v1 hook refusal without calling native hook', async () => {
  const x = setup();
  mockEditor = false;
  x.register('createOne');
  await expect(
    x.service.executePreQueryHooks(auth, 'person', 'createOne', { data: {} }),
  ).rejects.toThrow('Company read hooks');
  expect(x.execute).not.toHaveBeenCalled();
});
it('preserves ordinary native hook behavior and caller actor semantics', async () => {
  const x = setup();
  mockEditor = false;
  mockCompany = false;
  x.register('createOne');
  const output = await x.service.executePreQueryHooks(
    auth,
    'person',
    'createOne',
    { data: { createdBy: spoof } },
  );
  expect(output.data.createdBy).toEqual(spoof);
  expect(x.fence).not.toHaveBeenCalled();
});
