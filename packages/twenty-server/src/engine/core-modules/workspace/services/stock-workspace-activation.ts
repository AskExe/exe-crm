import { BadRequestException, type Logger } from '@nestjs/common';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { type DataSource, type Repository } from 'typeorm';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { type FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { type ActivateWorkspaceInput } from 'src/engine/core-modules/workspace/dtos/activate-workspace-input';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';
import { type PrefillLogicFunctionService } from 'src/engine/workspace-manager/standard-objects-prefill-data/services/prefill-logic-function.service';
import { prefillCompanies } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-companies.util';
import { prefillDashboards } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-dashboards.util';
import { prefillOpportunities } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-opportunities.util';
import { prefillPeople } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-people.util';
import { prefillWorkflowCommandMenuItems } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflow-command-menu-items.util';
import { getCreateCompanyWhenAddingNewPersonCodeStepLogicFunctionDefinitions } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflow-code-step-logic-functions.util';
import { prefillWorkflows } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util';
import { type WorkspaceManagerService } from 'src/engine/workspace-manager/workspace-manager.service';
import { DEFAULT_FEATURE_FLAGS } from 'src/engine/workspace-manager/workspace-migration/constant/default-feature-flags';
import { resolveEngineVersion } from 'src/utils/version/resolve-engine-version';

// These are concrete stock service ports, not callbacks or an authority issuer.
export type StockWorkspaceActivationProviders = {
  workspaceRepository: Pick<
    Repository<WorkspaceEntity>,
    'update' | 'findOneBy'
  >;
  coreEntityCacheService: Pick<CoreEntityCacheService, 'invalidate'>;
  featureFlagService: Pick<FeatureFlagService, 'enableFeatureFlags'>;
  workspaceManagerService: Pick<WorkspaceManagerService, 'init'>;
  userWorkspaceService: Pick<UserWorkspaceService, 'createWorkspaceMember'>;
  twentyConfigService: Pick<TwentyConfigService, 'get'>;
  flatEntityMapsCacheService: Pick<
    WorkspaceManyOrAllFlatEntityMapsCacheService,
    'getOrRecomputeManyOrAllFlatEntityMaps'
  >;
  prefillLogicFunctionService: Pick<
    PrefillLogicFunctionService,
    'ensureSeeded'
  >;
  coreDataSource: Pick<DataSource, 'createQueryRunner'>;
  logger: Pick<Logger, 'error'>;
};

export async function activateStockWorkspace(
  user: AuthContextUser,
  workspace: WorkspaceEntity,
  data: ActivateWorkspaceInput,
  providers: StockWorkspaceActivationProviders,
) {
  if (!data.displayName || !data.displayName.length) {
    throw new BadRequestException("'displayName' not provided");
  }

  if (
    workspace.activationStatus === WorkspaceActivationStatus.ONGOING_CREATION
  ) {
    throw new Error('Workspace is already being created');
  }

  if (
    workspace.activationStatus !== WorkspaceActivationStatus.PENDING_CREATION
  ) {
    throw new Error('Workspace is not pending creation');
  }

  await providers.workspaceRepository.update(workspace.id, {
    activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
  });

  await providers.coreEntityCacheService.invalidate(
    'workspaceEntity',
    workspace.id,
  );

  await providers.featureFlagService.enableFeatureFlags(
    DEFAULT_FEATURE_FLAGS,
    workspace.id,
  );

  await providers.workspaceManagerService.init({
    workspace,
    userId: user.id,
  });

  await providers.userWorkspaceService.createWorkspaceMember(
    workspace.id,
    user,
  );

  await prefillStockWorkspaceRecords(providers, {
    workspaceId: workspace.id,
    schemaName: getWorkspaceSchemaName(workspace.id),
  });

  const appVersion = providers.twentyConfigService.get('APP_VERSION');

  await providers.workspaceRepository.update(workspace.id, {
    displayName: data.displayName,
    activationStatus: WorkspaceActivationStatus.ACTIVE,
    // workspace.version lives on the migration-engine track, not the
    // exe-crm release track — stamping the raw APP_VERSION (0.9.x) would
    // make the next upgrade abort with WORKSPACE_VERSION_MISSMATCH
    // (bug 928a4140).
    version: resolveEngineVersion(appVersion).version,
  });

  await providers.coreEntityCacheService.invalidate(
    'workspaceEntity',
    workspace.id,
  );

  return await providers.workspaceRepository.findOneBy({
    id: workspace.id,
  });
}

async function prefillStockWorkspaceRecords(
  providers: StockWorkspaceActivationProviders,
  { workspaceId, schemaName }: { workspaceId: string; schemaName: string },
): Promise<void> {
  const { flatObjectMetadataMaps, flatFieldMetadataMaps, flatPageLayoutMaps } =
    await providers.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
      {
        workspaceId,
        flatMapsKeys: [
          'flatObjectMetadataMaps',
          'flatFieldMetadataMaps',
          'flatPageLayoutMaps',
        ],
      },
    );

  await providers.prefillLogicFunctionService.ensureSeeded({
    workspaceId,
    definitions:
      getCreateCompanyWhenAddingNewPersonCodeStepLogicFunctionDefinitions(
        workspaceId,
      ),
  });

  const queryRunner = providers.coreDataSource.createQueryRunner();

  await queryRunner.connect();

  try {
    await queryRunner.startTransaction();

    await prefillCompanies(queryRunner.manager, schemaName);

    await prefillPeople(queryRunner.manager, schemaName);

    await prefillWorkflows(
      queryRunner.manager,
      workspaceId,
      schemaName,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
    );

    await prefillWorkflowCommandMenuItems(queryRunner.manager, workspaceId);

    await prefillOpportunities(queryRunner.manager, schemaName);

    await prefillDashboards(
      queryRunner.manager,
      schemaName,
      flatPageLayoutMaps,
    );

    await queryRunner.commitTransaction();
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        providers.logger.error(
          `Failed to rollback prefill transaction: ${rollbackError.message}`,
        );
      }
    }

    throw error;
  } finally {
    await queryRunner.release();
  }
}
