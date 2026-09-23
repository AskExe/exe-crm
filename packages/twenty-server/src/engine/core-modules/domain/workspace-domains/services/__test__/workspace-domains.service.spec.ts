import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

describe('WorkspaceDomainsService', () => {
  let workspaceDomainsService: WorkspaceDomainsService;
  let twentyConfigService: TwentyConfigService;
  let workspaceRepository: Repository<WorkspaceEntity>;
  let publicDomainRepository: Repository<PublicDomainEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainServerConfigService,
        WorkspaceDomainsService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PublicDomainEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    workspaceRepository = module.get<Repository<WorkspaceEntity>>(
      getRepositoryToken(WorkspaceEntity),
    );
    publicDomainRepository = module.get<Repository<PublicDomainEntity>>(
      getRepositoryToken(PublicDomainEntity),
    );
    workspaceDomainsService = module.get<WorkspaceDomainsService>(
      WorkspaceDomainsService,
    );

    twentyConfigService = module.get<TwentyConfigService>(TwentyConfigService);
  });

  describe('getWorkspaceUrls', () => {
    it('should return a URL containing the correct customDomain if customDomain is provided', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = workspaceDomainsService.getWorkspaceUrls({
        subdomain: 'subdomain',
        customDomain: 'custom-host.com',
        isCustomDomainEnabled: true,
      });

      expect(result).toEqual({
        customUrl: 'https://custom-host.com/',
        subdomainUrl: 'https://example.com/',
      });
    });

    it('should return a URL containing the correct subdomain if customDomain is not provided but subdomain is', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = workspaceDomainsService.getWorkspaceUrls({
        subdomain: 'subdomain',
        customDomain: null,
        isCustomDomainEnabled: false,
      });

      expect(result).toEqual({
        customUrl: undefined,
        subdomainUrl: 'https://subdomain.example.com/',
      });
    });
  });

  describe('buildWorkspaceURL', () => {
    it('should build workspace URL with given subdomain', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
            DEFAULT_SUBDOMAIN: 'default',
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = workspaceDomainsService.buildWorkspaceURL({
        workspace: {
          subdomain: 'test',
          customDomain: null,
          isCustomDomainEnabled: false,
        },
      });

      expect(result.toString()).toBe('https://test.example.com/');
    });

    it('should set the pathname if provided', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = workspaceDomainsService.buildWorkspaceURL({
        workspace: {
          subdomain: 'test',
          customDomain: null,
          isCustomDomainEnabled: false,
        },
        pathname: '/path/to/resource',
      });

      expect(result.pathname).toBe('/path/to/resource');
    });

    it('should set the search parameters if provided', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = workspaceDomainsService.buildWorkspaceURL({
        workspace: {
          subdomain: 'test',
          customDomain: null,
          isCustomDomainEnabled: false,
        },
        searchParams: {
          foo: 'bar',
          baz: 123,
        },
      });

      expect(result.searchParams.get('foo')).toBe('bar');
      expect(result.searchParams.get('baz')).toBe('123');
    });
  });

  describe('getWorkspaceByOriginOrDefaultWorkspace', () => {
    it('keeps the managed Exe workspace as default when a newer DEMO exists', async () => {
      const previousManagedWorkspaceId = process.env.EXE_ORG_WORKSPACE_ID;

      process.env.EXE_ORG_WORKSPACE_ID = 'exe-workspace';
      try {
        jest.spyOn(twentyConfigService, 'get').mockReturnValue(false);
        const findOne = jest.spyOn(workspaceRepository, 'findOne');

        findOne.mockResolvedValueOnce({
          id: 'exe-workspace',
        } as WorkspaceEntity);
        const find = jest.spyOn(workspaceRepository, 'find');

        const result =
          await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
            'https://crm.example.com',
          );

        expect(result?.id).toBe('exe-workspace');
        expect(findOne).toHaveBeenCalledWith({
          where: { id: 'exe-workspace' },
          relations: ['workspaceSSOIdentityProviders'],
        });
        expect(find).not.toHaveBeenCalled();
      } finally {
        if (previousManagedWorkspaceId === undefined) {
          delete process.env.EXE_ORG_WORKSPACE_ID;
        } else {
          process.env.EXE_ORG_WORKSPACE_ID = previousManagedWorkspaceId;
        }
      }
    });

    it('fails closed when the configured managed Exe workspace is missing', async () => {
      const previousManagedWorkspaceId = process.env.EXE_ORG_WORKSPACE_ID;

      process.env.EXE_ORG_WORKSPACE_ID = 'missing-workspace';
      try {
        jest.spyOn(twentyConfigService, 'get').mockReturnValue(false);
        jest.spyOn(workspaceRepository, 'findOne').mockResolvedValueOnce(null);
        const find = jest.spyOn(workspaceRepository, 'find');

        await expect(
          workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
            'https://crm.example.com',
          ),
        ).rejects.toThrow();
        expect(find).not.toHaveBeenCalled();
      } finally {
        if (previousManagedWorkspaceId === undefined) {
          delete process.env.EXE_ORG_WORKSPACE_ID;
        } else {
          process.env.EXE_ORG_WORKSPACE_ID = previousManagedWorkspaceId;
        }
      }
    });

    it('should return default workspace if IS_MULTIWORKSPACE_ENABLED=false', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: false,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'find').mockResolvedValueOnce([
        {
          id: 'workspace-id',
        },
      ] as unknown as WorkspaceEntity[]);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://example.com',
        );

      expect(result?.id).toEqual('workspace-id');
    });

    it('should return 1st workspace if multiple workspaces when IS_MULTIWORKSPACE_ENABLED=false', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: false,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'find').mockResolvedValueOnce([
        {
          id: 'workspace-id1',
        },
        {
          id: 'workspace-id2',
        },
      ] as unknown as WorkspaceEntity[]);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://example.com',
        );

      expect(result?.id).toEqual('workspace-id1');
    });

    it('should return workspace by subdomain', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'findOne').mockResolvedValueOnce({
        id: 'workspace-id1',
        subdomain: '123',
      } as unknown as Promise<WorkspaceEntity>);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://123.example.com',
        );

      expect(result?.id).toEqual('workspace-id1');
    });

    it('should return workspace by customDomain', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'findOne').mockResolvedValueOnce({
        id: 'workspace-id1',
        customDomain: '123.custom.com',
      } as unknown as Promise<WorkspaceEntity>);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://123.custom.com',
        );

      expect(result?.id).toEqual('workspace-id1');
    });

    it('should return workspace by publicDomain', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'findOne').mockResolvedValueOnce({
        id: 'workspace-id1',
      } as unknown as Promise<WorkspaceEntity>);

      jest.spyOn(publicDomainRepository, 'findOne').mockResolvedValueOnce({
        domain: '123.custom.com',
        workspaceId: 'workspace-id1',
      } as unknown as Promise<PublicDomainEntity>);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://123.custom.com',
        );

      expect(result?.id).toEqual('workspace-id1');
    });

    it('should return undefined if nothing found', async () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      jest.spyOn(workspaceRepository, 'findOne').mockResolvedValueOnce(null);

      jest.spyOn(publicDomainRepository, 'findOne').mockResolvedValueOnce(null);

      const result =
        await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          'https://123.custom.com',
        );

      expect(result).toEqual(undefined);
    });
  });

  describe('getWorkspaceForVerifiedLoginToken', () => {
    const withManagedDemo = async (test: () => Promise<void>) => {
      const previousOrgId = process.env.EXE_ORG_WORKSPACE_ID;
      const previousDemoId = process.env.EXE_DEMO_WORKSPACE_ID;

      process.env.EXE_ORG_WORKSPACE_ID = 'exe-workspace';
      process.env.EXE_DEMO_WORKSPACE_ID = 'demo-workspace';
      try {
        await test();
      } finally {
        if (previousOrgId === undefined) {
          delete process.env.EXE_ORG_WORKSPACE_ID;
        } else {
          process.env.EXE_ORG_WORKSPACE_ID = previousOrgId;
        }
        if (previousDemoId === undefined) {
          delete process.env.EXE_DEMO_WORKSPACE_ID;
        } else {
          process.env.EXE_DEMO_WORKSPACE_ID = previousDemoId;
        }
      }
    };

    const configureSharedOrigin = () => {
      jest.spyOn(twentyConfigService, 'get').mockImplementation((key) => {
        if (key === 'IS_MULTIWORKSPACE_ENABLED') return false;
        if (key === 'FRONTEND_URL') return 'https://crm.example.com';
        return undefined;
      });
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockImplementation(async (options) => {
          if (options?.where && 'id' in options.where) {
            if (options.where.id === 'exe-workspace') {
              return { id: 'exe-workspace' } as WorkspaceEntity;
            }
            if (options.where.id === 'demo-workspace') {
              return {
                id: 'demo-workspace',
                displayName: 'DEMO',
                activationStatus: WorkspaceActivationStatus.ACTIVE,
                isCustomDomainEnabled: false,
              } as WorkspaceEntity;
            }
          }
          return null;
        });
    };

    it('exchanges a verified DEMO token on the shared CRM origin', async () => {
      await withManagedDemo(async () => {
        configureSharedOrigin();

        const workspace =
          await workspaceDomainsService.getWorkspaceForVerifiedLoginToken(
            'https://crm.example.com',
            'demo-workspace',
          );

        expect(workspace?.id).toBe('demo-workspace');
        expect(workspaceRepository.findOne).toHaveBeenCalledWith({
          where: {
            id: 'demo-workspace',
            displayName: 'DEMO',
            activationStatus: WorkspaceActivationStatus.ACTIVE,
          },
          relations: ['workspaceSSOIdentityProviders'],
        });
      });
    });

    it('keeps the Exe default for unrelated origins and workspace IDs', async () => {
      await withManagedDemo(async () => {
        configureSharedOrigin();

        const foreignOrigin =
          await workspaceDomainsService.getWorkspaceForVerifiedLoginToken(
            'https://other.example.com',
            'demo-workspace',
          );
        const unrelatedWorkspace =
          await workspaceDomainsService.getWorkspaceForVerifiedLoginToken(
            'https://crm.example.com',
            'other-workspace',
          );

        expect(foreignOrigin?.id).toBe('exe-workspace');
        expect(unrelatedWorkspace?.id).toBe('exe-workspace');
      });
    });
  });
});
