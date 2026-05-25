import { Controller, Get, UseGuards } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';

@Controller('healthz')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly redisClientService: RedisClientService,
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
