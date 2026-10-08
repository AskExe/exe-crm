import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { type AllMetadataName } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';
import { DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { PrivateNativeStructuralAdapter } from 'src/engine/core-modules/company-native-bootstrap/private-native-structural-adapter';
import { type PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { fencePrivateWorkspaceQueries } from 'src/engine/core-modules/company-native-bootstrap/private-native-workspace-query-fence';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { AllFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/all-flat-entity-maps.type';
import { getMetadataFlatEntityMapsKey } from 'src/engine/metadata-modules/flat-entity/utils/get-metadata-flat-entity-maps-key.util';
import { getMetadataRelatedMetadataNamesForValidation } from 'src/engine/metadata-modules/flat-entity/utils/get-metadata-related-metadata-names-for-validation.util';
import { getMetadataRelatedMetadataNames } from 'src/engine/metadata-modules/flat-entity/utils/get-metadata-related-metadata-names.util';
import { getMetadataSerializedRelationNames } from 'src/engine/metadata-modules/flat-entity/utils/get-metadata-serialized-relation-names.util';
import { FIND_ALL_VIEWS_GRAPHQL_OPERATION } from 'src/engine/metadata-modules/view/constants/find-all-views-graphql-operation.constant';
import { WorkspaceMetadataVersionService } from 'src/engine/metadata-modules/workspace-metadata-version/services/workspace-metadata-version.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceMigration } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/types/workspace-migration.type';

import {
  WorkspaceMigrationRunnerException,
  WorkspaceMigrationRunnerExceptionCode,
} from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/exceptions/workspace-migration-runner.exception';
import { WorkspaceMigrationRunnerActionHandlerRegistryService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/registry/workspace-migration-runner-action-handler-registry.service';
import { type MetadataEvent } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/types/metadata-event';

type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

@Injectable()
export class WorkspaceMigrationRunnerService {
  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    private readonly workspaceMigrationRunnerActionHandlerRegistry: WorkspaceMigrationRunnerActionHandlerRegistryService,
    private readonly workspaceMetadataVersionService: WorkspaceMetadataVersionService,
    private readonly workspaceCacheStorageService: WorkspaceCacheStorageService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly logger: LoggerService,
  ) {}

  private getLegacyCacheInvalidationPromises({
    allFlatEntityMapsKeys,
    workspaceId,
    privateFence,
    privateStructuralAdapter,
  }: {
    allFlatEntityMapsKeys: (keyof AllFlatEntityMaps)[];
    workspaceId: string;
    privateFence?: PrivateNativeMutationFence;
    privateStructuralAdapter?: PrivateNativeStructuralAdapter;
  }): Promise<void>[] {
    const asyncOperations: Promise<void>[] = [];
    if (privateStructuralAdapter) {
      PrivateNativeStructuralAdapter.assertIssued(privateStructuralAdapter);
      privateStructuralAdapter.assertFence(privateFence);
    }
    const guarded = async (operation: () => Promise<void>): Promise<void> => {
      if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
      await operation();
      if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    };
    const flatMapsKeysSet = new Set(allFlatEntityMapsKeys);

    const shouldIncrementMetadataGraphqlSchemaVersion =
      flatMapsKeysSet.has('flatObjectMetadataMaps') ||
      flatMapsKeysSet.has('flatFieldMetadataMaps');

    if (shouldIncrementMetadataGraphqlSchemaVersion) {
      asyncOperations.push(
        guarded(() =>
          this.workspaceMetadataVersionService.incrementMetadataVersion(
            workspaceId,
            privateFence,
            privateStructuralAdapter,
          ),
        ),
      );
    }

    const viewRelatedFlatMapsKeys: (keyof AllFlatEntityMaps)[] = [
      'flatViewMaps',
      'flatViewFilterMaps',
      'flatViewGroupMaps',
      'flatViewFieldMaps',
      'flatViewFilterGroupMaps',
    ];
    const shouldInvalidateFindViewsGraphqlCacheOperation =
      viewRelatedFlatMapsKeys.some((key) => flatMapsKeysSet.has(key));

    if (
      shouldInvalidateFindViewsGraphqlCacheOperation ||
      shouldIncrementMetadataGraphqlSchemaVersion
    ) {
      asyncOperations.push(
        guarded(() =>
          this.workspaceCacheStorageService.flushGraphQLOperation({
            operationName: FIND_ALL_VIEWS_GRAPHQL_OPERATION,
            workspaceId,
          }),
        ),
      );
    }

    const shouldInvalidateRoleMapCache =
      flatMapsKeysSet.has('flatRoleMaps') ||
      flatMapsKeysSet.has('flatRoleTargetMaps');

    const shouldInvalidateRolesPermissionsCache =
      flatMapsKeysSet.has('flatObjectPermissionMaps') ||
      flatMapsKeysSet.has('flatFieldPermissionMaps') ||
      flatMapsKeysSet.has('flatPermissionFlagMaps');

    if (
      shouldIncrementMetadataGraphqlSchemaVersion ||
      shouldInvalidateRoleMapCache ||
      shouldInvalidateRolesPermissionsCache
    ) {
      asyncOperations.push(
        guarded(() =>
          this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
            'rolesPermissions',
            'userWorkspaceRoleMap',
            'flatRoleTargetMaps',
            'apiKeyRoleMap',
            'ORMEntityMetadatas',
            'flatRoleTargetByAgentIdMaps',
            'graphQLResolverNameMap',
          ]),
        ),
      );
    }

    return asyncOperations;
  }

  async invalidateCache({
    allFlatEntityMapsKeys,
    workspaceId,
    privateFence,
    privateStructuralAdapter,
  }: {
    allFlatEntityMapsKeys: (keyof AllFlatEntityMaps)[];
    workspaceId: string;
    privateFence?: PrivateNativeMutationFence;
    privateStructuralAdapter?: PrivateNativeStructuralAdapter;
  }): Promise<void> {
    if (privateStructuralAdapter) {
      PrivateNativeStructuralAdapter.assertIssued(privateStructuralAdapter);
      privateStructuralAdapter.assertFence(privateFence);
    }
    this.logger.time(
      'Runner',
      `Cache invalidation ${allFlatEntityMapsKeys.join()}`,
    );

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    await this.flatEntityMapsCacheService.invalidateFlatEntityMaps({
      workspaceId,
      flatMapsKeys: allFlatEntityMapsKeys,
    });

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    const invalidationResults = await Promise.allSettled(
      this.getLegacyCacheInvalidationPromises({
        allFlatEntityMapsKeys,
        workspaceId,
        privateFence,
        privateStructuralAdapter,
      }),
    );

    const invalidationFailures = invalidationResults.filter(
      (result) => result.status === 'rejected',
    );

    if (invalidationFailures.length > 0) {
      if (privateFence)
        throw new AggregateError(
          invalidationFailures.map((result) => result.reason),
          'Private workspace cache requires reconciliation',
        );
      invalidationFailures.forEach((err) =>
        this.logger.error(
          `Failed to invalidate a legacy cache ${err.reason}`,
          'Runner',
        ),
      );
      throw new Error(
        `Failed to invalidate ${invalidationFailures.length} cache operations`,
      );
    }

    this.logger.timeEnd(
      'Runner',
      `Cache invalidation ${allFlatEntityMapsKeys.join()}`,
    );
  }

  run = async ({
    workspaceMigration: { actions, applicationUniversalIdentifier },
    workspaceId,
    privateFence,
    privateStructuralAdapter,
  }: {
    workspaceMigration: WorkspaceMigration;
    workspaceId: string;
    privateFence?: PrivateNativeMutationFence;
    privateStructuralAdapter?: PrivateNativeStructuralAdapter;
  }): Promise<{
    allFlatEntityMaps: AllFlatEntityMaps;
    metadataEvents: MetadataEvent[];
    hasSchemaMetadataChanged: boolean;
  }> => {
    if (privateStructuralAdapter) {
      PrivateNativeStructuralAdapter.assertIssued(privateStructuralAdapter);
      privateStructuralAdapter.assertComposition(
        this.coreDataSource,
        privateFence,
      );
    }
    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    this.logger.time('Runner', 'Total execution');
    this.logger.time('Runner', 'Initial cache retrieval');

    const queryRunner = this.coreDataSource.createQueryRunner();

    const actionMetadataNames = [
      ...new Set(actions.flatMap((action) => action.metadataName)),
    ];
    const actionsMetadataAndRelatedMetadataNames: AllMetadataName[] = [
      ...new Set([
        ...actionMetadataNames,
        ...actionMetadataNames.flatMap(getMetadataRelatedMetadataNames),
        ...actionMetadataNames.flatMap(getMetadataSerializedRelationNames),
        ...actionMetadataNames.flatMap(
          getMetadataRelatedMetadataNamesForValidation,
        ),
      ]),
    ];
    const allFlatEntityMapsKeys = actionsMetadataAndRelatedMetadataNames.map(
      getMetadataFlatEntityMapsKey,
    );

    let allFlatEntityMaps =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps<
        typeof allFlatEntityMapsKeys
      >({
        workspaceId,
        flatMapsKeys: allFlatEntityMapsKeys,
      });

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    this.logger.timeEnd('Runner', 'Initial cache retrieval');

    const { flatApplicationMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatApplicationMaps',
      ]);

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    const applicationId =
      flatApplicationMaps.idByUniversalIdentifier[
        applicationUniversalIdentifier
      ];
    const flatApplication = isDefined(applicationId)
      ? flatApplicationMaps.byId[applicationId]
      : undefined;

    if (!isDefined(applicationId) || !isDefined(flatApplication)) {
      throw new WorkspaceMigrationRunnerException({
        message: `Could not find application for application with universal identifier: ${applicationUniversalIdentifier}`,
        code: WorkspaceMigrationRunnerExceptionCode.APPLICATION_NOT_FOUND,
      });
    }

    if (privateFence) {
      const original = await privateFence.readOriginalWorkspace();
      if (applicationId !== original.standardApplicationId)
        throw new PrivateNativeActionUnavailable();
    }
    this.logger.time('Runner', 'Transaction execution');

    if (!privateFence) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }

    const allMetadataEvents: MetadataEvent[] = [];
    let restorePrivateQueries: (() => void) | undefined;
    let privatePrimary: unknown;

    try {
      if (privateFence) {
        restorePrivateQueries = await fencePrivateWorkspaceQueries(
          queryRunner,
          privateFence,
          workspaceId,
        );
        await queryRunner.connect();
        await queryRunner.startTransaction();
      }
      for (const action of actions) {
        const { partialOptimisticCache, metadataEvents } =
          await this.workspaceMigrationRunnerActionHandlerRegistry.executeActionHandler(
            {
              action,
              context: {
                flatApplication,
                action,
                allFlatEntityMaps,
                queryRunner,
                workspaceId,
              },
            },
          );

        allFlatEntityMaps = {
          ...allFlatEntityMaps,
          ...partialOptimisticCache,
        } as typeof allFlatEntityMaps;

        allMetadataEvents.push(...metadataEvents);
      }

      await queryRunner.commitTransaction();

      this.logger.timeEnd('Runner', 'Transaction execution');
    } catch (error) {
      if (privateFence) {
        // Revoked/private failures quarantine the original action. Do not run
        // compensating schema mutations outside the owned transaction.
        privatePrimary = error;
        throw error;
      }
      await queryRunner.rollbackTransaction().catch((rollbackError) =>
        // oxlint-disable-next-line no-console
        console.trace(
          `Failed to rollback transaction: ${rollbackError.message}`,
        ),
      );

      const invertedActions = [...actions].reverse();

      for (const invertedAction of invertedActions) {
        await this.workspaceMigrationRunnerActionHandlerRegistry.executeActionRollbackHandler(
          {
            action: invertedAction,
            context: {
              flatApplication,
              action: invertedAction,
              allFlatEntityMaps,
              workspaceId,
            },
          },
        );
      }

      if (error instanceof WorkspaceMigrationRunnerException) {
        throw error;
      }

      throw new WorkspaceMigrationRunnerException({
        message: error.message,
        code: WorkspaceMigrationRunnerExceptionCode.INTERNAL_SERVER_ERROR,
      });
    } finally {
      if (privateFence) {
        const secondary: unknown[] = [];
        try {
          restorePrivateQueries?.();
        } catch (error) {
          secondary.push(error);
        }
        if (queryRunner.isTransactionActive) {
          try {
            await queryRunner.rollbackTransaction();
          } catch (error) {
            secondary.push(error);
          }
        }
        try {
          await queryRunner.release();
        } catch (error) {
          secondary.push(error);
        }
        if (secondary.length)
          throw new AggregateError(
            privatePrimary === undefined
              ? secondary
              : [privatePrimary, ...secondary],
            'Private workspace migration requires reconciliation',
          );
      } else await queryRunner.release();
    }

    try {
      if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
      await this.invalidateCache({
        allFlatEntityMapsKeys,
        workspaceId,
        privateFence,
        privateStructuralAdapter,
      });
      if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    } catch (cacheError) {
      if (privateFence) throw cacheError;
      this.logger.error(
        `Cache invalidation failed after committed transaction: ${cacheError}`,
        'Runner',
      );
    }

    const hasSchemaMetadataChanged =
      allFlatEntityMapsKeys.includes('flatObjectMetadataMaps') ||
      allFlatEntityMapsKeys.includes('flatFieldMetadataMaps');

    this.logger.timeEnd('Runner', 'Total execution');

    return {
      allFlatEntityMaps,
      metadataEvents: allMetadataEvents,
      hasSchemaMetadataChanged,
    };
  };
}
