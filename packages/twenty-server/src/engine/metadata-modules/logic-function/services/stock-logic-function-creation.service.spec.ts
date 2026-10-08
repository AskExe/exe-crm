import { LogicFunctionResourceService } from 'src/engine/core-modules/logic-function/logic-function-resource/logic-function-resource.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { LogicFunctionFromSourceHelperService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source-helper.service';
import { LogicFunctionFromSourceService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source.service';
import { StockLogicFunctionCreationService } from 'src/engine/metadata-modules/logic-function/services/stock-logic-function-creation.service';
import { findFlatEntityByIdInFlatEntityMapsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util';

jest.mock(
  'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util',
  () => ({ findFlatEntityByIdInFlatEntityMapsOrThrow: jest.fn() }),
);

const workspaceId = '11111111-1111-4111-8111-111111111111';
const logicFunctionId = '22222222-2222-4222-8222-222222222222';
const applicationId = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const events: string[] = [];
  const uploadSourceFile = jest.fn(async () => {
    events.push('upload');
  });
  const seedSourceFiles = jest.fn(async () => {
    events.push('seed');
    return { handlerName: 'main', checksum: 'native-checksum' };
  });
  const createOneFromMetadata = jest.fn(async () => {
    events.push('metadata');
  });
  const owner = {
    id: applicationId,
    universalIdentifier: applicationId,
    workspaceId,
  };
  const applicationService = {
    findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest.fn(
      async () => ({ workspaceCustomFlatApplication: owner }),
    ),
  } as unknown as ApplicationService;
  const resources = {
    uploadSourceFile,
    seedSourceFiles,
  } as unknown as LogicFunctionResourceService;
  const helper = {
    buildHandlerPaths: jest.fn(() => ({
      sourceHandlerPath: 'src/' + logicFunctionId,
      builtHandlerPath: 'build/' + logicFunctionId,
    })),
    createOneFromMetadata,
  } as unknown as LogicFunctionFromSourceHelperService;
  const cache = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(async () => {
      events.push('readback');
      return { flatLogicFunctionMaps: {} };
    }),
  } as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService;
  jest.mocked(findFlatEntityByIdInFlatEntityMapsOrThrow).mockReturnValue({
    id: logicFunctionId,
    universalIdentifier: logicFunctionId,
    name: 'native-source',
    workspaceId,
    applicationId,
    runtime: 'nodejs',
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  } as never);
  return {
    events,
    uploadSourceFile,
    seedSourceFiles,
    createOneFromMetadata,
    applicationService,
    resources,
    helper,
    cache,
    service: new StockLogicFunctionCreationService(
      resources,
      applicationService,
      helper,
      cache,
    ),
  };
}

const input = {
  id: logicFunctionId,
  name: 'native-source',
  source: {
    sourceHandlerCode: 'export const main=()=>1;',
    handlerName: 'main',
    toolInputSchema: { type: 'object', properties: {} },
  },
};
describe('stock source creation without execution providers', () => {
  it('uploads supplied stock source, records the unbuilt metadata and performs actual DTO readback', async () => {
    const state = fixture();
    expect(
      await state.service.createOneFromSource({ workspaceId, input }),
    ).toMatchObject({
      id: logicFunctionId,
      workspaceId,
      applicationId,
      name: 'native-source',
    });
    expect(state.events).toEqual(['upload', 'metadata', 'readback']);
    expect(state.uploadSourceFile).toHaveBeenCalledWith({
      sourceHandlerPath: 'src/' + logicFunctionId,
      sourceHandlerCode: input.source.sourceHandlerCode,
      applicationUniversalIdentifier: applicationId,
      workspaceId,
    });
    expect(state.createOneFromMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        universalFlatLogicFunctionToCreate: expect.objectContaining({
          id: logicFunctionId,
          isBuildUpToDate: false,
          checksum: null,
          handlerName: 'main',
        }),
      }),
    );
    expect(state.seedSourceFiles).not.toHaveBeenCalled();
  });
  it('retains supported seed-file creation when no source was supplied', async () => {
    const state = fixture();
    await state.service.createOneFromSource({
      workspaceId,
      input: { id: logicFunctionId, name: 'native-source' },
    });
    expect(state.events).toEqual(['seed', 'metadata', 'readback']);
    expect(state.uploadSourceFile).not.toHaveBeenCalled();
    expect(state.createOneFromMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        universalFlatLogicFunctionToCreate: expect.objectContaining({
          isBuildUpToDate: true,
          checksum: 'native-checksum',
        }),
      }),
    );
  });
  it('preserves upload failure without later metadata or readback', async () => {
    const state = fixture();
    const primary = new Error('inert upload failure');
    state.uploadSourceFile.mockRejectedValueOnce(primary);
    await expect(
      state.service.createOneFromSource({ workspaceId, input }),
    ).rejects.toBe(primary);
    expect(state.createOneFromMetadata).not.toHaveBeenCalled();
    expect(state.events).toEqual([]);
  });
  it('ordinary source creation delegates with the same concrete providers and result', async () => {
    const state = fixture();
    const result = await Reflect.apply(
      LogicFunctionFromSourceService.prototype.createOneFromSource,
      {
        logicFunctionResourceService: state.resources,
        applicationService: state.applicationService,
        helperService: state.helper,
        flatEntityMapsCacheService: state.cache,
      },
      [{ workspaceId, input }],
    );
    expect(result).toMatchObject({ id: logicFunctionId, workspaceId });
    expect(state.events).toEqual(['upload', 'metadata', 'readback']);
  });
});
