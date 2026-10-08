import { v4 } from 'uuid';
import { SEED_LOGIC_FUNCTION_INPUT_SCHEMA } from 'twenty-shared/logic-function';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { LogicFunctionResourceService } from 'src/engine/core-modules/logic-function/logic-function-resource/logic-function-resource.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { findFlatEntityByIdInFlatEntityMapsOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps-or-throw.util';
import { CreateLogicFunctionFromSourceInput } from 'src/engine/metadata-modules/logic-function/dtos/create-logic-function-from-source.input';
import { LogicFunctionDTO } from 'src/engine/metadata-modules/logic-function/dtos/logic-function.dto';
import { LogicFunctionFromSourceHelperService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source-helper.service';
import { fromCreateLogicFunctionFromSourceInputToUniversalFlatLogicFunctionToCreate } from 'src/engine/metadata-modules/logic-function/utils/from-create-logic-function-from-source-input-to-universal-flat-logic-function-to-create.util';
import { fromFlatLogicFunctionToLogicFunctionDto } from 'src/engine/metadata-modules/logic-function/utils/from-flat-logic-function-to-logic-function-dto.util';

// Stock source creation without execution, token minting, or scheduler providers.
export class StockLogicFunctionCreationService {
  constructor(
    private readonly logicFunctionResourceService: LogicFunctionResourceService,
    private readonly applicationService: ApplicationService,
    private readonly helperService: LogicFunctionFromSourceHelperService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
  ) {}
  async createOneFromSource({
    input,
    workspaceId,
  }: {
    input: CreateLogicFunctionFromSourceInput;
    workspaceId: string;
  }): Promise<LogicFunctionDTO> {
    const { workspaceCustomFlatApplication: ownerFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const logicFunctionId = input.id ?? v4();

    const { sourceHandlerPath, builtHandlerPath } =
      this.helperService.buildHandlerPaths(logicFunctionId);

    if (input.source) {
      await this.logicFunctionResourceService.uploadSourceFile({
        sourceHandlerPath,
        sourceHandlerCode: input.source.sourceHandlerCode,
        applicationUniversalIdentifier:
          ownerFlatApplication.universalIdentifier,
        workspaceId,
      });

      const universalFlatLogicFunctionToCreate =
        fromCreateLogicFunctionFromSourceInputToUniversalFlatLogicFunctionToCreate(
          {
            createLogicFunctionFromSourceInput: {
              ...input,
              id: logicFunctionId,
            },
            sourceHandlerPath,
            builtHandlerPath,
            handlerName: input.source.handlerName,
            checksum: null,
            toolInputSchema: input.source.toolInputSchema,
            isBuildUpToDate: false,
            applicationUniversalIdentifier:
              ownerFlatApplication.universalIdentifier,
          },
        );

      await this.helperService.createOneFromMetadata({
        universalFlatLogicFunctionToCreate,
        workspaceId,
      });

      return this.findFlatLogicFunctionByIdAndConvertToDto({
        id: universalFlatLogicFunctionToCreate.id,
        workspaceId,
      });
    }

    const { handlerName, checksum } =
      await this.logicFunctionResourceService.seedSourceFiles({
        sourceHandlerPath,
        builtHandlerPath,
        workspaceId,
        applicationUniversalIdentifier:
          ownerFlatApplication.universalIdentifier,
      });

    const universalFlatLogicFunctionToCreate =
      fromCreateLogicFunctionFromSourceInputToUniversalFlatLogicFunctionToCreate(
        {
          createLogicFunctionFromSourceInput: { ...input, id: logicFunctionId },
          sourceHandlerPath,
          builtHandlerPath,
          handlerName,
          checksum,
          toolInputSchema: SEED_LOGIC_FUNCTION_INPUT_SCHEMA,
          isBuildUpToDate: true,
          applicationUniversalIdentifier:
            ownerFlatApplication.universalIdentifier,
        },
      );

    await this.helperService.createOneFromMetadata({
      universalFlatLogicFunctionToCreate,
      workspaceId,
    });

    return this.findFlatLogicFunctionByIdAndConvertToDto({
      id: universalFlatLogicFunctionToCreate.id,
      workspaceId,
    });
  }
  private async findFlatLogicFunctionByIdAndConvertToDto({
    id,
    workspaceId,
  }: {
    id: string;
    workspaceId: string;
  }): Promise<LogicFunctionDTO> {
    const { flatLogicFunctionMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: ['flatLogicFunctionMaps'],
        },
      );

    return fromFlatLogicFunctionToLogicFunctionDto({
      flatLogicFunction: findFlatEntityByIdInFlatEntityMapsOrThrow({
        flatEntityId: id,
        flatEntityMaps: flatLogicFunctionMaps,
      }),
    });
  }
}
