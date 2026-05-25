import { HealthCheckService } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { HealthController } from 'src/engine/core-modules/health/controllers/health.controller';

describe('HealthController', () => {
  let healthController: HealthController;

  beforeEach(async () => {
    const testingModule: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: { check: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn() },
        },
        {
          provide: RedisClientService,
          useValue: {
            getClient: jest.fn(),
            getQueueClient: jest.fn(),
          },
        },
      ],
    }).compile();

    healthController = testingModule.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(healthController).toBeDefined();
  });
});
