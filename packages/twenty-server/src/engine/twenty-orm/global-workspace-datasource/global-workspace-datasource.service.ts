import {
  Injectable,
  Inject,
  Optional,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { DataSource } from 'typeorm';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { GlobalWorkspaceDataSource } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';

import {
  PRIVATE_NATIVE_STOCK_POOL_CUSTODY,
  PrivateNativeStockPoolCustody,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-pool-custody';

import {
  PRIVATE_PEOPLE_POOL_CUSTODY,
  type PrivatePeoplePoolCustody,
} from 'src/engine/core-modules/company-people/private-people-io-custody';

@Injectable()
export class GlobalWorkspaceDataSourceService
  implements OnModuleInit, OnApplicationShutdown
{
  private globalWorkspaceDataSource: GlobalWorkspaceDataSource | null = null;
  private globalWorkspaceDataSourceReplica: GlobalWorkspaceDataSource | null =
    null;

  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    @Optional()
    @Inject(PRIVATE_PEOPLE_POOL_CUSTODY)
    private readonly privatePoolCustody?: PrivatePeoplePoolCustody,
    @Optional()
    @Inject(PRIVATE_NATIVE_STOCK_POOL_CUSTODY)
    private readonly privateStockPoolCustody?: PrivateNativeStockPoolCustody,
  ) {
    if (privatePoolCustody && privateStockPoolCustody)
      throw new Error('Conflicting private database profiles');
  }

  async onModuleInit(): Promise<void> {
    this.globalWorkspaceDataSource = new GlobalWorkspaceDataSource(
      {
        url: this.twentyConfigService.get('PG_DATABASE_URL'),
        type: 'postgres',
        logging: this.twentyConfigService.getLoggingConfig(),
        entities: [],
        ssl: this.twentyConfigService.get('PG_SSL_ALLOW_SELF_SIGNED')
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
        poolSize: this.twentyConfigService.get('PG_POOL_MAX_CONNECTIONS'),
        extra: {
          query_timeout: this.twentyConfigService.get(
            'PG_DATABASE_PRIMARY_TIMEOUT_MS',
          ),
          idleTimeoutMillis: this.twentyConfigService.get(
            'PG_POOL_IDLE_TIMEOUT_MS',
          ),
          allowExitOnIdle: this.twentyConfigService.get(
            'PG_POOL_ALLOW_EXIT_ON_IDLE',
          ),
        },
      },
      this.workspaceEventEmitter,
      this.coreDataSource,
    );

    await (this.privatePoolCustody
      ? this.privatePoolCustody.initialize(this.globalWorkspaceDataSource)
      : this.privateStockPoolCustody
        ? this.privateStockPoolCustody.initialize(
            this.globalWorkspaceDataSource,
          )
        : this.globalWorkspaceDataSource.initialize());

    const shouldInitializeReplicaDataSource = isDefined(
      this.twentyConfigService.get('PG_DATABASE_REPLICA_URL'),
    );

    if (shouldInitializeReplicaDataSource) {
      this.globalWorkspaceDataSourceReplica = new GlobalWorkspaceDataSource(
        {
          url: this.twentyConfigService.get('PG_DATABASE_REPLICA_URL'),
          type: 'postgres',
          logging: this.twentyConfigService.getLoggingConfig(),
          entities: [],
          ssl: this.twentyConfigService.get('PG_SSL_ALLOW_SELF_SIGNED')
            ? {
                rejectUnauthorized: false,
              }
            : undefined,
          poolSize: this.twentyConfigService.get('PG_POOL_MAX_CONNECTIONS'),
          extra: {
            query_timeout: this.twentyConfigService.get(
              'PG_DATABASE_REPLICA_TIMEOUT_MS',
            ),
            idleTimeoutMillis: this.twentyConfigService.get(
              'PG_POOL_IDLE_TIMEOUT_MS',
            ),
            allowExitOnIdle: this.twentyConfigService.get(
              'PG_POOL_ALLOW_EXIT_ON_IDLE',
            ),
          },
        },
        this.workspaceEventEmitter,
        this.coreDataSource,
      );
      await (this.privatePoolCustody
        ? this.privatePoolCustody.initialize(
            this.globalWorkspaceDataSourceReplica,
          )
        : this.privateStockPoolCustody
          ? this.privateStockPoolCustody.initialize(
              this.globalWorkspaceDataSourceReplica,
            )
          : this.globalWorkspaceDataSourceReplica.initialize());
    }
  }

  public getGlobalWorkspaceDataSource(): GlobalWorkspaceDataSource {
    if (!isDefined(this.globalWorkspaceDataSource)) {
      throw new Error(
        'GlobalWorkspaceDataSource has not been initialized. Make sure the module has been initialized.',
      );
    }

    return this.globalWorkspaceDataSource;
  }

  public getGlobalWorkspaceDataSourceReplica(): GlobalWorkspaceDataSource {
    if (!isDefined(this.globalWorkspaceDataSourceReplica)) {
      return this.getGlobalWorkspaceDataSource();
    }

    return this.globalWorkspaceDataSourceReplica;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.globalWorkspaceDataSource) {
      await (this.privatePoolCustody
        ? this.privatePoolCustody.close(this.globalWorkspaceDataSource)
        : this.privateStockPoolCustody
          ? this.privateStockPoolCustody.close(this.globalWorkspaceDataSource)
          : this.globalWorkspaceDataSource.destroy());
      this.globalWorkspaceDataSource = null;
    }
    if (this.globalWorkspaceDataSourceReplica) {
      await (this.privatePoolCustody
        ? this.privatePoolCustody.close(this.globalWorkspaceDataSourceReplica)
        : this.privateStockPoolCustody
          ? this.privateStockPoolCustody.close(
              this.globalWorkspaceDataSourceReplica,
            )
          : this.globalWorkspaceDataSourceReplica.destroy());
      this.globalWorkspaceDataSourceReplica = null;
    }
  }
}
