import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckError,
  HealthCheckService,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { WorkspaceBootstrapService } from 'src/engine/core-modules/workspace/services/workspace-bootstrap.service';

@Controller('healthz')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly redisClientService: RedisClientService,
    private readonly workspaceBootstrapService: WorkspaceBootstrapService,
  ) {}

  @Get()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        await this.withTimeout(
          this.dataSource.query('SELECT 1'),
          'database readiness check timed out',
        );

        return { database: { status: 'up' } };
      },
      async () => {
        await this.withTimeout(
          this.redisClientService.getClient().ping(),
          'redis readiness check timed out',
        );
        await this.withTimeout(
          this.redisClientService.getQueueClient().ping(),
          'redis queue readiness check timed out',
        );

        return { redis: { status: 'up' } };
      },
      // A CRM that never seeded its first workspace and admin user cannot be
      // signed into by anyone. Database and Redis are both "up" in that state,
      // so without this indicator the probe reports healthy on an install that
      // is completely unusable.
      async () => {
        const { ready, reason } = await this.withTimeout(
          this.workspaceBootstrapService.checkReadiness(),
          'workspace bootstrap readiness check timed out',
        );

        if (!ready) {
          throw new HealthCheckError('workspaceBootstrap is not ready', {
            workspaceBootstrap: { status: 'down', message: reason },
          });
        }

        return { workspaceBootstrap: { status: 'up' } };
      },
    ]);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    message: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), 3000);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
