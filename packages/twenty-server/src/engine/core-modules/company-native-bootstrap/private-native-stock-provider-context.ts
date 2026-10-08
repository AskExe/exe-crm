import { KeyValuePairService } from 'src/engine/core-modules/key-value-pair/key-value-pair.service';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ConsoleLogger,
  Module,
  type INestApplicationContext,
  type Provider,
} from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';

import { caching } from 'cache-manager';
import { EventEmitter2 } from 'eventemitter2';
import { DataSource } from 'typeorm';

import { ScalarsExplorerService } from 'src/engine/api/graphql/services/scalars-explorer.service';
import { StockSdkSchemaFactory } from 'src/engine/api/graphql/stock-sdk-schema.factory';
import { StockWorkspaceSchemaPartsService } from 'src/engine/api/graphql/stock-workspace-schema-parts.service';
import { WorkspaceGraphQLSchemaGenerator } from 'src/engine/api/graphql/workspace-schema-builder/workspace-graphql-schema.factory';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PRIVATE_STOCK_ACTIONS } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-actions';
import { PRIVATE_STOCK_CACHES } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-caches';
import { PRIVATE_NATIVE_STOCK_ENTITIES } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-entities';
import { PrivateNativeStockEnvironment } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-environment';
import {
  PRIVATE_NATIVE_STOCK_POOL_CUSTODY,
  PrivateNativeStockPoolCustody,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pool-custody';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { PrivateNativeStockSdkChannel } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-channel';
import { PrivateNativeStockSdkService } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk.service';
import { PRIVATE_STOCK_SERVICES1 } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-services-1';
import { PRIVATE_STOCK_SERVICES2 } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-services-2';
import {
  PRIVATE_NATIVE_STOCK_STORAGE,
  PrivateNativeStockStorage,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { LOGGER_DRIVER } from 'src/engine/core-modules/logger/logger.constants';
import { SdkClientGenerationService } from 'src/engine/core-modules/sdk-client/sdk-client-generation.service';
import { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { StockWorkspaceMemberCreationService } from 'src/engine/core-modules/user-workspace/stock-workspace-member-creation.service';
import { StockUserWorkspaceRemovalService } from 'src/engine/core-modules/user-workspace/stock-user-workspace-removal.service';
import { StockUserSoftDeletionService } from 'src/engine/core-modules/user/services/stock-user-soft-deletion.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { DataSourceService } from 'src/engine/metadata-modules/data-source/data-source.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { LogicFunctionFromSourceService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source.service';
import { LogicFunctionResourceService } from 'src/engine/core-modules/logic-function/logic-function-resource/logic-function-resource.service';
import { LogicFunctionFromSourceHelperService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source-helper.service';
import { StockLogicFunctionCreationService } from 'src/engine/metadata-modules/logic-function/services/stock-logic-function-creation.service';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';

const issuedContexts = new WeakMap<
  INestApplicationContext,
  Readonly<{
    checkpoint: PrivateNativeStockActionCheckpoint;
    database: DataSource;
  }>
>();

export function assertPrivateStockProviderContext(
  context: INestApplicationContext,
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
): void {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  const binding = issuedContexts.get(context);
  if (
    !binding ||
    binding.checkpoint !== checkpoint ||
    binding.database !== database
  )
    throw new PrivateNativeActionUnavailable();
}

@Module({})
class PrivateStockProviderModule {}

// Concrete closed provider composition. The caller cannot contribute providers,
// modules, repositories, configuration, authority callbacks or entity selectors.
export async function createPrivateStockProviderContext(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
  control: PrivateNativeStockRoleGuard,
  custody: PrivateNativeStockPoolCustody,
  storage: PrivateNativeStockStorage,
  channel: PrivateNativeStockSdkChannel,
): Promise<INestApplicationContext> {
  PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
  PrivateNativeStockPoolCustody.assertIssued(custody);
  PrivateNativeStockStorage.assertIssued(storage);
  PrivateNativeStockSdkChannel.assertIssued(channel);
  custody.assertBinding(database, control, checkpoint);
  storage.assertCheckpoint(checkpoint);
  channel.assertCheckpoint(checkpoint);
  await control.assertBusinessDatabase(database, checkpoint);
  const databaseUrl = await control.readBusinessConnectionString(
    database,
    checkpoint,
  );
  const cache = await caching('memory', { max: 500, ttl: 120000 });
  await checkpoint.assertCurrent();
  const providers: Provider[] = [
    KeyValuePairService,
    UserVarsService,
    ...PRIVATE_STOCK_ACTIONS,
    ...PRIVATE_STOCK_CACHES,
    ...[...PRIVATE_STOCK_SERVICES1, ...PRIVATE_STOCK_SERVICES2].filter(
      (provider) => provider !== EnvironmentConfigDriver,
    ),
    { provide: DataSource, useValue: database },
    ...PRIVATE_NATIVE_STOCK_ENTITIES.map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: database.getRepository(entity),
    })),
    {
      provide: EnvironmentConfigDriver,
      useValue: new PrivateNativeStockEnvironment(databaseUrl),
    },
    { provide: PRIVATE_NATIVE_STOCK_POOL_CUSTODY, useValue: custody },
    { provide: PRIVATE_NATIVE_STOCK_STORAGE, useValue: storage },
    { provide: CACHE_MANAGER, useValue: cache },
    { provide: EventEmitter2, useValue: new EventEmitter2() },
    { provide: LOGGER_DRIVER, useValue: new ConsoleLogger() },
    ...Object.values(CacheStorageNamespace).map((namespace) => ({
      provide: namespace,
      useValue: new CacheStorageService(cache, namespace),
    })),
    {
      provide: StockWorkspaceMemberCreationService,
      useFactory: (orm: GlobalWorkspaceOrmManager) =>
        new StockWorkspaceMemberCreationService(
          database.getRepository(UserWorkspaceEntity),
          orm,
        ),
      inject: [GlobalWorkspaceOrmManager],
    },
    {
      provide: StockUserWorkspaceRemovalService,
      useValue: new StockUserWorkspaceRemovalService(
        database.getRepository(UserWorkspaceEntity),
        database.getRepository(RoleTargetEntity),
      ),
    },
    {
      provide: StockUserSoftDeletionService,
      useFactory: (core: CoreEntityCacheService) =>
        new StockUserSoftDeletionService(
          database.getRepository(UserEntity),
          core,
        ),
      inject: [CoreEntityCacheService],
    },
    {
      provide: StockWorkspaceSchemaPartsService,
      useFactory: (
        scalars: ScalarsExplorerService,
        generator: WorkspaceGraphQLSchemaGenerator,
        cacheStorage: WorkspaceCacheStorageService,
        maps: WorkspaceManyOrAllFlatEntityMapsCacheService,
        features: FeatureFlagService,
        sources: DataSourceService,
      ) =>
        new StockWorkspaceSchemaPartsService(
          scalars,
          generator,
          cacheStorage,
          maps,
          features,
          sources,
        ),
      inject: [
        ScalarsExplorerService,
        WorkspaceGraphQLSchemaGenerator,
        WorkspaceCacheStorageService,
        WorkspaceManyOrAllFlatEntityMapsCacheService,
        FeatureFlagService,
        DataSourceService,
      ],
    },
    {
      provide: StockSdkSchemaFactory,
      useFactory: (
        parts: StockWorkspaceSchemaPartsService,
        scalars: ScalarsExplorerService,
      ) => new StockSdkSchemaFactory(parts, scalars),
      inject: [StockWorkspaceSchemaPartsService, ScalarsExplorerService],
    },
    {
      provide: SdkClientGenerationService,
      useFactory: (
        schema: StockSdkSchemaFactory,
        files: FileStorageService,
        workspaceCache: WorkspaceCacheService,
      ) =>
        new PrivateNativeStockSdkService(
          checkpoint,
          database,
          control,
          schema,
          channel,
          files,
          workspaceCache,
        ),
      inject: [
        StockSdkSchemaFactory,
        FileStorageService,
        WorkspaceCacheService,
      ],
    },
    {
      provide: LogicFunctionFromSourceService,
      useFactory: (
        resource: LogicFunctionResourceService,
        applications: ApplicationService,
        helper: LogicFunctionFromSourceHelperService,
        maps: WorkspaceManyOrAllFlatEntityMapsCacheService,
      ) =>
        new StockLogicFunctionCreationService(
          resource,
          applications,
          helper,
          maps,
        ),
      inject: [
        LogicFunctionResourceService,
        ApplicationService,
        LogicFunctionFromSourceHelperService,
        WorkspaceManyOrAllFlatEntityMapsCacheService,
      ],
    },
  ];
  const context = await NestFactory.createApplicationContext(
    {
      module: PrivateStockProviderModule,
      imports: [DiscoveryModule],
      providers,
    },
    { logger: false, abortOnError: false },
  );
  try {
    await checkpoint.assertCurrent();
    issuedContexts.set(context, Object.freeze({ checkpoint, database }));
    return context;
  } catch (primary) {
    try {
      await context.close();
    } catch (cleanup) {
      throw new PrivateStockProviderContextFailure(primary, [cleanup]);
    }
    throw primary;
  }
}

export class PrivateStockProviderContextFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private stock provider context requires reconciliation');
  }
}
