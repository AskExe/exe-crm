import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ApprovedAccessDomainEntity } from 'src/engine/core-modules/approved-access-domain/approved-access-domain.entity';
import { DomainServerConfigService } from 'src/engine/core-modules/domain/domain-server-config/services/domain-server-config.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

describe('SubdomainManagerService', () => {
  let domainServerConfigService: DomainServerConfigService;
  let twentyConfigService: TwentyConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainServerConfigService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ApprovedAccessDomainEntity),
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

    domainServerConfigService = module.get<DomainServerConfigService>(
      DomainServerConfigService,
    );
    twentyConfigService = module.get<TwentyConfigService>(TwentyConfigService);
  });

  describe('buildBaseUrl', () => {
    it('should build the base URL from environment variables', () => {
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

      const result = domainServerConfigService.getBaseUrl();

      expect(result.toString()).toBe('https://example.com/');
    });

    it('should append default subdomain if multiworkspace is enabled', () => {
      jest
        .spyOn(twentyConfigService, 'get')
        // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        .mockImplementation(((key: string) => {
          const env: Record<string, unknown> = {
            FRONTEND_URL: 'https://example.com',
            IS_MULTIWORKSPACE_ENABLED: true,
            DEFAULT_SUBDOMAIN: 'test',
          };

          return env[key];
          // oxlint-disable-next-line @typescripttypescript/no-explicit-any
        }) as any);

      const result = domainServerConfigService.getBaseUrl();

      expect(result.toString()).toBe('https://test.example.com/');
    });
  });
});
