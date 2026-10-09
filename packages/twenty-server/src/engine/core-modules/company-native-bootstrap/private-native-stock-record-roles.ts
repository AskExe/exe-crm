import { type INestApplicationContext } from '@nestjs/common';

import { type DataSource } from 'typeorm';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { v5 } from 'uuid';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { assertPrivateStockProviderContext } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-provider-context';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { ObjectPermissionService } from 'src/engine/metadata-modules/object-permission/object-permission.service';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';

export const PRIVATE_STOCK_RECORD_ROLES = Object.freeze([
  Object.freeze({
    kind: 'reader',
    label: 'Company record reader',
    write: false,
  }),
  Object.freeze({
    kind: 'writer',
    label: 'Company record writer',
    write: true,
  }),
]);

// These roles carry no current subject grant. The original subject remains Guest;
// only the separate current Core authority transaction may adopt one observed role.
export async function prepareOriginalStockRecordRoles(
  checkpoint: PrivateNativeStockActionCheckpoint,
  database: DataSource,
  control: PrivateNativeStockRoleGuard,
  context: INestApplicationContext,
): Promise<void> {
  assertPrivateStockProviderContext(context, checkpoint, database);
  await control.assertBusinessDatabase(database, checkpoint);
  await checkpoint.assertCurrent();
  const original = checkpoint.pendingPlan.original;
  const applications = await context
    .get(ApplicationService)
    .findWorkspaceTwentyStandardAndCustomApplicationOrThrow({
      workspaceId: original.workspaceId,
    });
  await checkpoint.assertCurrent();
  if (
    applications.workspaceCustomFlatApplication.id !==
    original.customApplicationId
  )
    throw new PrivateNativeActionUnavailable();
  const maps = await context
    .get(WorkspaceManyOrAllFlatEntityMapsCacheService)
    .getOrRecomputeManyOrAllFlatEntityMaps({
      workspaceId: original.workspaceId,
      flatMapsKeys: ['flatObjectMetadataMaps'],
    });
  await checkpoint.assertCurrent();
  const objects = [STANDARD_OBJECTS.person, STANDARD_OBJECTS.company].map(
    (standard) =>
      maps.flatObjectMetadataMaps.byUniversalIdentifier[
        standard.universalIdentifier
      ],
  );
  if (
    objects[0]?.id === objects[1]?.id ||
    objects.some(
      (object, index) =>
        !object ||
        object.isSystem ||
        object.universalIdentifier !==
          [STANDARD_OBJECTS.person, STANDARD_OBJECTS.company][index]
            .universalIdentifier ||
        object.nameSingular !== ['person', 'company'][index] ||
        object.workspaceId !== original.workspaceId ||
        object.applicationId !== applications.twentyStandardFlatApplication.id,
    )
  )
    throw new PrivateNativeActionUnavailable();
  const roles = context.get(RoleService);
  const permissions = context.get(ObjectPermissionService);
  for (const slot of PRIVATE_STOCK_RECORD_ROLES) {
    await checkpoint.assertCurrent();
    const roleId = v5(
      `private-native-stock-record-${slot.kind}-role-v1`,
      original.actionId,
    );
    const role = await roles.createRole({
      workspaceId: original.workspaceId,
      ownerFlatApplication: applications.workspaceCustomFlatApplication,
      input: {
        id: roleId,
        universalIdentifier: v5(
          `private-native-stock-record-${slot.kind}-role-universal-v1`,
          original.actionId,
        ),
        label: slot.label,
        isEditable: true,
        canBeAssignedToUsers: true,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canUpdateAllSettings: false,
        canAccessAllTools: false,
      },
    });
    await checkpoint.assertCurrent();
    if (role.id !== roleId) throw new PrivateNativeActionUnavailable();
    await permissions.upsertObjectPermissions({
      workspaceId: original.workspaceId,
      input: {
        roleId,
        objectPermissions: objects.map((object) => {
          if (!object) throw new PrivateNativeActionUnavailable();
          return {
            objectMetadataId: object.id,
            canReadObjectRecords: true,
            canUpdateObjectRecords: slot.write,
            canSoftDeleteObjectRecords: false,
            canDestroyObjectRecords: false,
          };
        }),
      },
    });
    await checkpoint.assertCurrent();
    // Native validators require an editable role while permissions are built.
    // The supported hidden lock operation prevents later ordinary role editing.
    const locked = await roles.updateRole({
      workspaceId: original.workspaceId,
      ownerFlatApplication: applications.workspaceCustomFlatApplication,
      input: { id: roleId, update: { isEditable: false } },
    });
    await checkpoint.assertCurrent();
    if (locked.id !== roleId || locked.isEditable)
      throw new PrivateNativeActionUnavailable();
  }
}
