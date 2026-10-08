import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { prefillCompanies } from 'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-companies.util';

import { WorkspaceService } from '../workspace.service';

import {
  activateStockWorkspace,
  type StockWorkspaceActivationProviders,
} from '../stock-workspace-activation';

jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-companies.util',
);
jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-people.util',
);
jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflows.util',
);
jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-workflow-command-menu-items.util',
);
jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-opportunities.util',
);
jest.mock(
  'src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-dashboards.util',
);

const user = { id: 'original-user' } as AuthContextUser;
const workspace = {
  id: '123e4567-e89b-42d3-a456-426614174001',
  activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
} as WorkspaceEntity;

function fixture() {
  const runner = {
    manager: {},
    isTransactionActive: true,
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const ports = {
    workspaceRepository: {
      update: jest.fn().mockResolvedValue(undefined),
      findOneBy: jest.fn().mockResolvedValue(workspace),
    },
    coreEntityCacheService: {
      invalidate: jest.fn().mockResolvedValue(undefined),
    },
    featureFlagService: {
      enableFeatureFlags: jest.fn().mockResolvedValue(undefined),
    },
    workspaceManagerService: { init: jest.fn().mockResolvedValue(undefined) },
    userWorkspaceService: {
      createWorkspaceMember: jest.fn().mockResolvedValue(undefined),
    },
    twentyConfigService: { get: jest.fn().mockReturnValue('0.9.0') },
    flatEntityMapsCacheService: {
      getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
        flatObjectMetadataMaps: {},
        flatFieldMetadataMaps: {},
        flatPageLayoutMaps: {},
      }),
    },
    prefillLogicFunctionService: {
      ensureSeeded: jest.fn().mockResolvedValue(undefined),
    },
    coreDataSource: { createQueryRunner: jest.fn().mockReturnValue(runner) },
    logger: { error: jest.fn() },
  };
  return {
    ports,
    runner,
    providers: ports as unknown as StockWorkspaceActivationProviders,
  };
}

beforeEach(() => jest.clearAllMocks());

it.each([
  WorkspaceActivationStatus.ACTIVE,
  WorkspaceActivationStatus.ONGOING_CREATION,
])(
  'refuses %s without starting stock initialization or writing',
  async (activationStatus) => {
    const f = fixture();
    await expect(
      activateStockWorkspace(
        user,
        { ...workspace, activationStatus },
        { displayName: 'Company' },
        f.providers,
      ),
    ).rejects.toThrow();
    expect(f.ports.workspaceRepository.update).not.toHaveBeenCalled();
    expect(f.ports.workspaceManagerService.init).not.toHaveBeenCalled();
  },
);

it('uses the original workspace and user through native initialization and member creation', async () => {
  const f = fixture();
  await expect(
    activateStockWorkspace(
      user,
      workspace,
      { displayName: 'Company' },
      f.providers,
    ),
  ).resolves.toBe(workspace);
  expect(f.ports.workspaceManagerService.init).toHaveBeenCalledWith({
    workspace,
    userId: user.id,
  });
  expect(
    f.ports.userWorkspaceService.createWorkspaceMember,
  ).toHaveBeenCalledWith(workspace.id, user);
  expect(f.ports.workspaceRepository.update).toHaveBeenLastCalledWith(
    workspace.id,
    expect.objectContaining({
      activationStatus: WorkspaceActivationStatus.ACTIVE,
    }),
  );
  expect(f.runner.commitTransaction).toHaveBeenCalledTimes(1);
  expect(f.runner.release).toHaveBeenCalledTimes(1);
});

it('does not publish ACTIVE after a failed stock initialization', async () => {
  const f = fixture(),
    primary = new Error('stock init failed');
  f.ports.workspaceManagerService.init.mockRejectedValue(primary);
  await expect(
    activateStockWorkspace(
      user,
      workspace,
      { displayName: 'Company' },
      f.providers,
    ),
  ).rejects.toBe(primary);
  expect(f.ports.workspaceRepository.update).toHaveBeenCalledTimes(1);
  expect(
    f.ports.userWorkspaceService.createWorkspaceMember,
  ).not.toHaveBeenCalled();
  expect(f.ports.coreDataSource.createQueryRunner).not.toHaveBeenCalled();
});

it('preserves the prefill failure, rolls back and releases, and does not publish ACTIVE', async () => {
  const f = fixture(),
    primary = new Error('prefill failed');
  jest.mocked(prefillCompanies).mockRejectedValueOnce(primary);
  await expect(
    activateStockWorkspace(
      user,
      workspace,
      { displayName: 'Company' },
      f.providers,
    ),
  ).rejects.toBe(primary);
  expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  expect(f.runner.release).toHaveBeenCalledTimes(1);
  expect(f.ports.workspaceRepository.update).toHaveBeenCalledTimes(1);
});

it('preserves a commit failure and closes the original stock runner', async () => {
  const f = fixture(),
    primary = new Error('commit failed');
  f.runner.commitTransaction.mockRejectedValue(primary);
  await expect(
    activateStockWorkspace(
      user,
      workspace,
      { displayName: 'Company' },
      f.providers,
    ),
  ).rejects.toBe(primary);
  expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  expect(f.runner.release).toHaveBeenCalledTimes(1);
  expect(f.ports.workspaceRepository.update).toHaveBeenCalledTimes(1);
});

it('keeps the ordinary WorkspaceService entry on the shared stock path', async () => {
  const f = fixture();
  const result = await WorkspaceService.prototype.activateWorkspace.call(
    f.ports as unknown as WorkspaceService,
    user,
    workspace,
    { displayName: 'Company' },
  );
  expect(result).toBe(workspace);
  expect(f.ports.workspaceManagerService.init).toHaveBeenCalledWith({
    workspace,
    userId: user.id,
  });
  expect(f.runner.commitTransaction).toHaveBeenCalledTimes(1);
  expect(f.runner.release).toHaveBeenCalledTimes(1);
});
