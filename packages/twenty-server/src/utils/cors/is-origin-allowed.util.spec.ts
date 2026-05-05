import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';

import { isOriginAllowed } from './is-origin-allowed.util';

describe('isOriginAllowed', () => {
  const twentyConfigService = {
    get: jest.fn(),
  } as any;
  const workspaceDomainsService = {
    getWorkspaceByOriginOrDefaultWorkspace: jest.fn(),
  } as any;

  const mockConfig = (overrides: Record<string, unknown> = {}) => {
    twentyConfigService.get.mockImplementation((key: string) => {
      const values: Record<string, unknown> = {
        FRONTEND_URL: 'https://crm.example.com',
        IS_MULTIWORKSPACE_ENABLED: false,
        NODE_ENV: NodeEnvironment.PRODUCTION,
        SERVER_URL: 'https://api.example.com',
        ...overrides,
      };

      return values[key];
    });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockConfig();
  });

  it('allows configured frontend and server origins', async () => {
    await expect(
      isOriginAllowed({
        origin: 'https://crm.example.com',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(true);

    await expect(
      isOriginAllowed({
        origin: 'https://api.example.com',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(true);
  });

  it('allows localhost origins only in development', async () => {
    mockConfig({
      NODE_ENV: NodeEnvironment.DEVELOPMENT,
    });

    await expect(
      isOriginAllowed({
        origin: 'http://localhost:3000',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(true);

    mockConfig({
      NODE_ENV: NodeEnvironment.PRODUCTION,
    });

    await expect(
      isOriginAllowed({
        origin: 'http://localhost:3000',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(false);
  });

  it('rejects unconfigured origins when multiworkspace is disabled', async () => {
    await expect(
      isOriginAllowed({
        origin: 'https://tenant.example.com',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(false);

    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('allows workspace origins resolved through the workspace domains service', async () => {
    mockConfig({
      IS_MULTIWORKSPACE_ENABLED: true,
    });
    workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
      { id: 'workspace-id' },
    );

    await expect(
      isOriginAllowed({
        origin: 'https://tenant.example.com',
        twentyConfigService,
        workspaceDomainsService,
      }),
    ).resolves.toBe(true);

    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).toHaveBeenCalledWith('https://tenant.example.com');
  });
});
