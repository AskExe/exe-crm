import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { WorkspaceDomainsModule } from 'src/engine/core-modules/domain/workspace-domains/workspace-domains.module';
import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { JwtModule } from 'src/engine/core-modules/jwt/jwt.module';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { DataSourceModule } from 'src/engine/metadata-modules/data-source/data-source.module';
import { WorkspaceManyOrAllFlatEntityMapsCacheModule } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.module';
import { AdminTokenMiddleware } from 'src/engine/middlewares/admin-token.middleware';
import { MiddlewareService } from 'src/engine/middlewares/middleware.service';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

// @Global so AdminTokenMiddleware is resolvable when applied via configure() in AppModule
@Global()
@Module({
  imports: [
    DataSourceModule,
    FeatureFlagModule,
    WorkspaceCacheStorageModule,
    WorkspaceManyOrAllFlatEntityMapsCacheModule,
    TokenModule,
    JwtModule,
    WorkspaceDomainsModule,
    TypeOrmModule.forFeature([WorkspaceEntity]),
  ],
  providers: [MiddlewareService, AdminTokenMiddleware],
  exports: [MiddlewareService, AdminTokenMiddleware],
})
export class MiddlewareModule {}
