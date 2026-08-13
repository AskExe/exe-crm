import { type ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { RedisClientService } from 'src/engine/core-modules/redis-client/redis-client.service';
import { HealthController } from 'src/engine/core-modules/health/controllers/health.controller';
import { WorkspaceBootstrapService } from 'src/engine/core-modules/workspace/services/workspace-bootstrap.service';

describe('HealthController', () => {
  let healthController: HealthController;
  let checkReadiness: jest.Mock;

  beforeEach(async () => {
    checkReadiness = jest.fn().mockResolvedValue({ ready: true });

    const ping = jest.fn().mockResolvedValue('PONG');

    // The real TerminusModule is used, not a mocked HealthCheckService, so the
    // assertions below are on the response GET /healthz actually returns.
    const testingModule: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([{ '1': 1 }]) },
        },
        {
          provide: RedisClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue({ ping }),
            getQueueClient: jest.fn().mockReturnValue({ ping }),
          },
        },
        {
          provide: WorkspaceBootstrapService,
          useValue: { checkReadiness },
        },
      ],
    }).compile();

    healthController = testingModule.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(healthController).toBeDefined();
  });

  describe('when the workspace bootstrap succeeded', () => {
    it('reports ok', async () => {
      const result = await healthController.check();

      expect(result.status).toBe('ok');
      expect(result.details.workspaceBootstrap).toEqual({ status: 'up' });
    });
  });

  describe('when a workspace already exists so the bootstrap was skipped', () => {
    it('reports ok', async () => {
      checkReadiness.mockResolvedValue({ ready: true });

      const result = await healthController.check();

      expect(result.status).toBe('ok');
    });
  });

  describe('when the workspace bootstrap failed', () => {
    beforeEach(() => {
      checkReadiness.mockResolvedValue({
        ready: false,
        reason:
          'EXE_CRM_ADMIN_EMAIL must be set to bootstrap the workspace admin user.',
      });
    });

    it('refuses to report healthyFail', async () => {
      const error = (await healthController
        .check()
        .catch((err) => err)) as ServiceUnavailableException;

      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({
        status: 'error',
        details: {
          workspaceBootstrap: {
            status: 'down',
            message:
              'EXE_CRM_ADMIN_EMAIL must be set to bootstrap the workspace admin user.',
          },
        },
      });
    });

    it('still reports database and redis as up, so the reason is unambiguousFail', async () => {
      const error = (await healthController
        .check()
        .catch((err) => err)) as ServiceUnavailableException;

      expect(error.getResponse()).toMatchObject({
        info: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });

    it('recovers to ok once the bootstrap succeeds', async () => {
      await expect(healthController.check()).rejects.toBeDefined();

      checkReadiness.mockResolvedValue({ ready: true });

      const result = await healthController.check();

      expect(result.status).toBe('ok');
    });
  });
});
