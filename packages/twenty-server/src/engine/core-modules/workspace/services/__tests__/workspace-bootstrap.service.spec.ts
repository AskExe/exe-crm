import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { WorkspaceBootstrapService } from 'src/engine/core-modules/workspace/services/workspace-bootstrap.service';

describe('WorkspaceBootstrapService', () => {
  let service: WorkspaceBootstrapService;
  let query: jest.Mock;
  let runnerQuery: jest.Mock;
  let commitTransaction: jest.Mock;
  let rollbackTransaction: jest.Mock;
  const originalAdminEmail = process.env.EXE_CRM_ADMIN_EMAIL;

  /** Number of existing non-deleted workspaces the mocked database reports. */
  let workspaceCount: number;

  beforeEach(async () => {
    workspaceCount = 0;
    runnerQuery = jest.fn().mockResolvedValue(undefined);
    commitTransaction = jest.fn().mockResolvedValue(undefined);
    rollbackTransaction = jest.fn().mockResolvedValue(undefined);
    query = jest.fn(async () => [{ count: workspaceCount }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceBootstrapService,
        {
          provide: getDataSourceToken(),
          useValue: {
            query,
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn().mockResolvedValue(undefined),
              startTransaction: jest.fn().mockResolvedValue(undefined),
              query: runnerQuery,
              commitTransaction,
              rollbackTransaction,
              release: jest.fn().mockResolvedValue(undefined),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WorkspaceBootstrapService>(WorkspaceBootstrapService);

    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'debug').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.EXE_CRM_ADMIN_EMAIL;
    } else {
      process.env.EXE_CRM_ADMIN_EMAIL = originalAdminEmail;
    }
  });

  describe('when the admin email is not usable', () => {
    describe.each([
      ['unset', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
    ])('EXE_CRM_ADMIN_EMAIL %s', (_label, value) => {
      beforeEach(async () => {
        if (value === undefined) {
          delete process.env.EXE_CRM_ADMIN_EMAIL;
        } else {
          process.env.EXE_CRM_ADMIN_EMAIL = value;
        }

        await service.onModuleInit();
      });

      it('reports not ready and names the missing variableFail', async () => {
        const readiness = await service.checkReadiness();

        expect(readiness.ready).toBe(false);
        expect(readiness.reason).toContain('EXE_CRM_ADMIN_EMAIL');
      });

      it('seeds nothing at allFail', () => {
        expect(runnerQuery).not.toHaveBeenCalled();
        expect(commitTransaction).not.toHaveBeenCalled();
      });

      it('does not kill the processFail', async () => {
        await expect(service.onModuleInit()).resolves.toBeUndefined();
      });
    });
  });

  describe('when the admin email is set and the database is empty', () => {
    beforeEach(async () => {
      process.env.EXE_CRM_ADMIN_EMAIL = 'owner@example.com';

      await service.onModuleInit();
    });

    it('reports ready', async () => {
      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
    });

    it('commits the seed', () => {
      expect(commitTransaction).toHaveBeenCalledTimes(1);
      expect(rollbackTransaction).not.toHaveBeenCalled();
    });

    it('adds no database work to the readiness probe', async () => {
      const callsAfterBoot = query.mock.calls.length;

      await service.checkReadiness();

      expect(query.mock.calls.length).toBe(callsAfterBoot);
    });
  });

  describe('when the admin email is padded and mixed case', () => {
    beforeEach(async () => {
      process.env.EXE_CRM_ADMIN_EMAIL = ' Owner@Example.com ';

      await service.onModuleInit();
    });

    it('reports ready', async () => {
      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
    });

    it('normalises the address before inserting it', () => {
      const userInsert = runnerQuery.mock.calls.find(([sql]: [string]) =>
        sql.includes('core."user"'),
      );

      expect(userInsert?.[1]).toContain('owner@example.com');
    });
  });

  describe('when a workspace already exists', () => {
    beforeEach(async () => {
      workspaceCount = 1;
      delete process.env.EXE_CRM_ADMIN_EMAIL;

      await service.onModuleInit();
    });

    it('reports ready even with no admin email configured', async () => {
      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
    });

    it('leaves the existing install untouched', () => {
      expect(runnerQuery).not.toHaveBeenCalled();
      expect(commitTransaction).not.toHaveBeenCalled();
      expect(rollbackTransaction).not.toHaveBeenCalled();
    });
  });

  describe('recovery', () => {
    it('reports ready once the missing variable is supplied', async () => {
      delete process.env.EXE_CRM_ADMIN_EMAIL;
      await service.onModuleInit();
      await expect(service.checkReadiness()).resolves.toMatchObject({
        ready: false,
      });

      process.env.EXE_CRM_ADMIN_EMAIL = 'owner@example.com';

      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
      expect(commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('reports ready once a workspace appears by any other route', async () => {
      delete process.env.EXE_CRM_ADMIN_EMAIL;
      await service.onModuleInit();

      workspaceCount = 1;

      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
      expect(commitTransaction).not.toHaveBeenCalled();
    });

    it('reports not ready while the database is down, then ready when it returns', async () => {
      process.env.EXE_CRM_ADMIN_EMAIL = 'owner@example.com';
      query.mockRejectedValue(new Error('connection refused'));

      await service.onModuleInit();

      const whileDown = await service.checkReadiness();

      expect(whileDown.ready).toBe(false);
      expect(whileDown.reason).toContain('connection refused');

      query.mockImplementation(async () => [{ count: workspaceCount }]);

      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
    });

    it('keeps reporting not ready while the cause persists', async () => {
      delete process.env.EXE_CRM_ADMIN_EMAIL;
      await service.onModuleInit();

      const first = await service.checkReadiness();
      const second = await service.checkReadiness();

      expect(first.ready).toBe(false);
      expect(second.ready).toBe(false);
    });
  });

  describe('rollback', () => {
    it('rolls back and reports not ready while a seed insert keeps failingFail', async () => {
      process.env.EXE_CRM_ADMIN_EMAIL = 'owner@example.com';
      runnerQuery.mockRejectedValue(new Error('constraint violation'));

      await service.onModuleInit();

      expect(rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(commitTransaction).not.toHaveBeenCalled();

      const readiness = await service.checkReadiness();

      expect(readiness.ready).toBe(false);
      expect(readiness.reason).toContain('constraint violation');
    });

    it('reports ready once a retried seed succeeds', async () => {
      process.env.EXE_CRM_ADMIN_EMAIL = 'owner@example.com';
      runnerQuery.mockRejectedValueOnce(new Error('deadlock detected'));

      await service.onModuleInit();

      expect(rollbackTransaction).toHaveBeenCalledTimes(1);

      await expect(service.checkReadiness()).resolves.toEqual({ ready: true });
      expect(commitTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
