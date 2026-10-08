import { ConsoleLogger, type INestApplicationContext } from '@nestjs/common';

import { type DataSource } from 'typeorm';
import { v5 } from 'uuid';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { assertPrivateStockProviderContext } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-provider-context';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { StockWorkspaceMemberCreationService } from 'src/engine/core-modules/user-workspace/stock-workspace-member-creation.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { activateStockWorkspace } from 'src/engine/core-modules/workspace/services/stock-workspace-activation';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { PrefillLogicFunctionService } from 'src/engine/workspace-manager/standard-objects-prefill-data/services/prefill-logic-function.service';
import { WorkspaceManagerService } from 'src/engine/workspace-manager/workspace-manager.service';

// No caller-selected identity, workspace or providers. This operation alone is
// not readiness: subject ACL/onboarding, setup removal, withdrawal and independent
// observation must all complete under the same original action afterward.
export async function activateOriginalStockWorkspace(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
  control: PrivateNativeStockRoleGuard,
  context: INestApplicationContext,
): Promise<void> {
  assertPrivateStockProviderContext(context, checkpoint, database);
  await control.assertBusinessDatabase(database, checkpoint);
  const original = checkpoint.pendingPlan.original;
  const setupUserId = v5(
    'private-native-stock-setup-user-v1',
    original.actionId,
  );
  const setup = await database
    .getRepository(UserEntity)
    .findOneByOrFail({ id: setupUserId });
  await checkpoint.assertCurrent();
  if (
    !setup.disabled ||
    setup.isEmailVerified ||
    setup.passwordHash ||
    setup.canImpersonate ||
    setup.canAccessFullAdminPanel ||
    setup.deletedAt ||
    setup.email !== `setup-${setupUserId}@native.invalid`
  )
    throw new PrivateNativeActionUnavailable();
  const workspace = await database
    .getRepository(WorkspaceEntity)
    .findOneByOrFail({ id: original.workspaceId });
  await checkpoint.assertCurrent();
  if (
    workspace.id !== original.workspaceId ||
    workspace.databaseSchema !== null ||
    workspace.deletedAt
  )
    throw new PrivateNativeActionUnavailable();
  await activateStockWorkspace(
    fromUserEntityToFlat(setup),
    workspace,
    { displayName: workspace.displayName || 'Company' },
    {
      workspaceRepository: database.getRepository(WorkspaceEntity),
      coreEntityCacheService: context.get(CoreEntityCacheService),
      featureFlagService: context.get(FeatureFlagService),
      workspaceManagerService: context.get(WorkspaceManagerService),
      userWorkspaceService: context.get(StockWorkspaceMemberCreationService),
      twentyConfigService: context.get(TwentyConfigService),
      flatEntityMapsCacheService: context.get(
        WorkspaceManyOrAllFlatEntityMapsCacheService,
      ),
      prefillLogicFunctionService: context.get(PrefillLogicFunctionService),
      coreDataSource: database,
      logger: new ConsoleLogger(),
    },
  );
  await checkpoint.assertCurrent();
}
