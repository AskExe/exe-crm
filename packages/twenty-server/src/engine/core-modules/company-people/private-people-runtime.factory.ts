import { Module, type INestApplicationContext } from '@nestjs/common';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { createClient, type RedisDefaultModules } from 'redis';
import { caching } from 'cache-manager';
import { redisInsStore } from 'cache-manager-redis-yet';
import { DataSource } from 'typeorm';

import { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { EntitySchemaFactory } from 'src/engine/twenty-orm/factories/entity-schema.factory';
import { EntitySchemaColumnFactory } from 'src/engine/twenty-orm/factories/entity-schema-column.factory';
import { EntitySchemaRelationFactory } from 'src/engine/twenty-orm/factories/entity-schema-relation.factory';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import {
  WorkspaceCacheService,
  PRIVATE_PEOPLE_CURRENT_CACHE,
} from 'src/engine/workspace-cache/services/workspace-cache.service';
import { type PrivatePeopleDeadline } from './private-people-contract';
import { type PrivatePeopleWorkerResources } from './private-people-worker-package';
import { PRIVATE_PEOPLE_POOL_CUSTODY } from './private-people-io-custody';
import {
  PrivatePeopleIOCustody,
  PrivatePeopleContextCustody,
  PrivatePeopleAssemblySettlement,
  type PrivatePeopleAssemblyLifecycle,
  type PrivatePeopleAssemblyFactory,
} from './private-people-assembly-lifecycle';
import {
  PRIVATE_PEOPLE_METADATA_ENTITIES,
  PRIVATE_PEOPLE_CACHE_PROVIDERS,
} from './private-people-assembly-graph';
import { readPrivatePeopleAssemblyConfiguration } from './private-people-assembly-config';
import {
  privatePeopleConnectionUrl,
  PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
} from './private-people-pool-options';
import { assertPrivatePeopleMetadataRole } from './private-people-metadata-guard';

// Unregistered factory. Packaging must bind this exact export into the fixed
// root-owned CJS file; no ordinary module/entry imports or enables this factory.
class OwnedPrivatePeopleAssembly implements PrivatePeopleAssemblyLifecycle {
  private readonly custody = new PrivatePeopleIOCustody();
  private readonly contextCustody = new PrivatePeopleContextCustody(
    this.custody,
  );
  private contextPromise?: Promise<INestApplicationContext>;
  private context?: INestApplicationContext;
  private preparation?: Promise<PrivatePeopleWorkerResources>;
  private disposal?: Promise<void>;
  private finalization?: Promise<void>;
  private refusal?: Promise<void>;
  private state:
    | 'new'
    | 'preparing'
    | 'ready'
    | 'disposing'
    | 'disposed'
    | 'finalized'
    | 'refusing' = 'new';

  abort(reason: unknown) {
    this.custody.abort(reason);
  }
  prepare(work: PrivatePeopleDeadline): Promise<PrivatePeopleWorkerResources> {
    if (this.state !== 'new')
      return Promise.reject(new Error('Private assembly one-shot unavailable'));
    this.custody.admit(work);
    this.state = 'preparing';
    this.preparation = this.prepareOwned().catch((error: unknown) => {
      this.abort(error);
      throw error;
    });
    return this.preparation;
  }
  private async prepareOwned(): Promise<PrivatePeopleWorkerResources> {
    const fixed = readPrivatePeopleAssemblyConfiguration();
    this.custody.assertCurrent();
    const metadata = new DataSource({
      type: 'postgres',
      url: privatePeopleConnectionUrl(fixed.metadata),
      schema: 'core',
      entities: PRIVATE_PEOPLE_METADATA_ENTITIES,
      synchronize: false,
      migrationsRun: false,
      logging: false,
      poolSize: 1,
      connectTimeoutMS: PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
      extra: {
        query_timeout: 1000,
        statement_timeout: 1000,
        connectionTimeoutMillis: PRIVATE_PEOPLE_CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: 1000,
        allowExitOnIdle: true,
      },
    });
    await this.custody.initialize(metadata);
    await this.custody.checked(assertPrivatePeopleMetadataRole(metadata));
    const redis = createClient<
      RedisDefaultModules,
      Record<string, never>,
      Record<string, never>
    >({
      socket: {
        host: fixed.redis.host,
        port: 6379,
        connectTimeout: 1000,
        reconnectStrategy: false,
      },
      username: 'crm_people_cache',
      password: fixed.redis.password,
      database: 0,
      disableOfflineQueue: true,
    });
    // No log body or unhandled error publication. Error is sticky and aborts ACK.
    redis.on('error', (error) => this.abort(error));
    await this.custody.own(
      redis,
      () => redis.connect(),
      async () => {
        if (redis.isOpen) await redis.quit();
      },
    );
    const store = redisInsStore(redis, { ttl: 1000 });
    const cacheManager = await this.custody.checked(caching(store));
    const cacheStorage = new CacheStorageService(
      cacheManager,
      CacheStorageNamespace.EngineWorkspace,
    );
    const eventEmitter = new EventEmitter2();
    this.contextCustody.retainListeners(eventEmitter);
    const emitter = new WorkspaceEventEmitter(eventEmitter);
    const custody = this.custody;
    @Module({
      imports: [DiscoveryModule],
      providers: [
        { provide: getDataSourceToken(), useValue: metadata },
        {
          provide: 'PRIVATE_PEOPLE_OWNED_IO_TEARDOWN',
          useValue: {
            onModuleDestroy: async () => {
              await custody.close(redis);
              await custody.close(metadata);
            },
          },
        },
        ...PRIVATE_PEOPLE_METADATA_ENTITIES.map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: metadata.getRepository(entity),
        })),
        { provide: EnvironmentConfigDriver, useValue: fixed.driver },
        TwentyConfigService,
        { provide: PRIVATE_PEOPLE_POOL_CUSTODY, useValue: custody },
        {
          provide: CacheStorageNamespace.EngineWorkspace,
          useValue: cacheStorage,
        },
        { provide: WorkspaceEventEmitter, useValue: emitter },
        {
          provide: PRIVATE_PEOPLE_CURRENT_CACHE,
          useValue: {
            assertCurrent: async () => {
              custody.assertCurrent();
              await assertPrivatePeopleMetadataRole(metadata);
              custody.assertCurrent();
            },
          },
        },
        WorkspaceCacheService,
        GlobalWorkspaceDataSourceService,
        GlobalWorkspaceOrmManager,
        EntitySchemaFactory,
        EntitySchemaColumnFactory,
        EntitySchemaRelationFactory,
        ...PRIVATE_PEOPLE_CACHE_PROVIDERS,
      ],
    })
    class PrivatePeopleModule {}
    // Pending context is retained before awaiting. Every IO-producing provider
    // above either uses an already-owned resource or the exact pool custody hook.
    this.contextPromise = NestFactory.createApplicationContext(
      PrivatePeopleModule,
      { abortOnError: false, logger: false },
    );
    this.contextCustody.retain(this.contextPromise);
    this.context = await this.contextPromise;
    this.custody.assertCurrent();
    if (this.state !== 'preparing')
      throw new Error('Private assembly late preparation');
    const orm = this.context.get(GlobalWorkspaceOrmManager);
    const writer = await this.custody.checked(
      orm.getGlobalWorkspaceDataSource(),
    );
    const cache = this.context.get(WorkspaceCacheService);
    // Require actual decorated discovery for all ten keys; provider absence
    // refuses naturally on recomputation. Do not replace maps with fixture data.
    this.custody.assertCurrent();
    this.state = 'ready';
    return {
      configuration: fixed.configuration,
      core: metadata,
      writer,
      orm,
      cache,
      emitter,
    };
  }
  disposeIO(cleanup: PrivatePeopleDeadline): Promise<void> {
    this.custody.limitClosure(cleanup);
    if (!this.disposal) {
      this.state = 'disposing';
      const closing = Promise.allSettled([this.custody.dispose(cleanup)]);
      this.disposal = (async () => {
        // Settle partial/late preparation BEFORE taking the complete IO pathset.
        // If it cannot settle in time, no ACK; parent owns the hard fail-stop.
        if (this.preparation) await Promise.allSettled([this.preparation]);
        const closed = await closing;
        if (closed[0].status === 'rejected') throw closed[0].reason;
        this.custody.assertCurrent();
        this.state = 'disposed';
      })();
    }
    return this.disposal;
  }
  finalize(cleanup: PrivatePeopleDeadline): Promise<void> {
    this.custody.limitClosure(cleanup);
    if (!this.finalization)
      this.finalization = (async () => {
        if (!this.disposal || this.state !== 'disposed')
          throw new Error('Private assembly finalization unavailable');
        await this.disposal;
        await this.custody.dispose(cleanup); // Same exact idempotent close promises.
        await this.contextCustody.close();
        this.custody.assertCurrent();
        this.state = 'finalized';
      })();
    return this.finalization;
  }
  refuse(
    reason: unknown,
    priorSecondary: readonly unknown[] = [],
  ): Promise<void> {
    this.abort(reason);
    if (!this.refusal) {
      this.state = 'refusing';
      this.refusal = (async () => {
        const primary = this.custody.primaryFailure(reason);
        const secondary: unknown[] = [...priorSecondary];
        // No passed or newly computed deadline. Known IO close attempts use
        // only the first admission and every previously shortened ceiling.
        let io: Promise<PromiseSettledResult<void>[]> | undefined;
        try {
          io = Promise.allSettled([this.custody.settleKnownIO()]);
        } catch (error) {
          secondary.push(error);
        }
        if (this.preparation) await Promise.allSettled([this.preparation]);
        if (io) {
          const settled = await io;
          if (settled[0].status === 'rejected' && settled[0].reason !== primary)
            secondary.push(settled[0].reason);
        }
        try {
          await this.contextCustody.close();
        } catch (error) {
          if (error !== primary) secondary.push(error);
        }
        // Refusal always retains the original primary; never a clean ACK.
        throw new PrivatePeopleAssemblySettlement(primary, secondary);
      })();
    }
    return this.refusal;
  }
}

export const privatePeopleAssemblyFactory: PrivatePeopleAssemblyFactory =
  Object.freeze({
    version: 1,
    createOwnedLifecycle: () => new OwnedPrivatePeopleAssembly(),
  });
