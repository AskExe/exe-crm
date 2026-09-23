import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { EXE_DEMO_VIEWER_ROLE } from 'src/engine/core-modules/auth/constants/exe-managed-roles.constant';
import { WorkspaceRolesPermissionsCacheService } from 'src/engine/metadata-modules/role/services/workspace-roles-permissions-cache.service';

const role = (universalIdentifier: string) => ({
  id: universalIdentifier,
  universalIdentifier,
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: false,
  objectPermissions: [],
  permissionFlags: [],
  fieldPermissions: [],
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
});

const objectMetadata = (
  id: string,
  universalIdentifier: string,
  isSystem: boolean,
) => ({
  id,
  universalIdentifier,
  isSystem,
  labelIdentifierFieldMetadataId: null,
});

describe('WorkspaceRolesPermissionsCacheService public DEMO privacy', () => {
  const demoRole = role(EXE_DEMO_VIEWER_ROLE.universalIdentifier);
  const ordinaryRole = role('ordinary-viewer');
  const objects = [
    objectMetadata(
      'workspace-member',
      STANDARD_OBJECTS.workspaceMember.universalIdentifier,
      true,
    ),
    objectMetadata(
      'connected-account',
      STANDARD_OBJECTS.connectedAccount.universalIdentifier,
      true,
    ),
    objectMetadata(
      'message-channel',
      STANDARD_OBJECTS.messageChannel.universalIdentifier,
      true,
    ),
    objectMetadata(
      'calendar-channel',
      STANDARD_OBJECTS.calendarChannel.universalIdentifier,
      true,
    ),
    objectMetadata(
      'attachment',
      STANDARD_OBJECTS.attachment.universalIdentifier,
      true,
    ),
    objectMetadata(
      'workflow-run',
      STANDARD_OBJECTS.workflowRun.universalIdentifier,
      true,
    ),
    objectMetadata('synthetic-company', 'synthetic-company', false),
  ];

  const service = new WorkspaceRolesPermissionsCacheService(
    { find: jest.fn().mockResolvedValue(objects) } as never,
    { find: jest.fn().mockResolvedValue([demoRole, ordinaryRole]) } as never,
  );

  it('denies the public DEMO role access to member and integration identities', async () => {
    const permissions = await service.computeForCache('demo-workspace');

    for (const objectId of [
      'workspace-member',
      'connected-account',
      'message-channel',
      'calendar-channel',
    ]) {
      expect(permissions[demoRole.id][objectId]).toMatchObject({
        canReadObjectRecords: false,
        canUpdateObjectRecords: false,
        canSoftDeleteObjectRecords: false,
        canDestroyObjectRecords: false,
      });
    }
  });

  it('allows only safe system reads and denies every system mutation', async () => {
    const permissions = await service.computeForCache('demo-workspace');

    expect(permissions[demoRole.id].attachment).toMatchObject({
      canReadObjectRecords: true,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    });
    expect(permissions[demoRole.id]['workflow-run']).toMatchObject({
      canReadObjectRecords: false,
      canUpdateObjectRecords: false,
      canSoftDeleteObjectRecords: false,
      canDestroyObjectRecords: false,
    });
  });

  it('keeps synthetic CRM records readable and does not change other roles', async () => {
    const permissions = await service.computeForCache('demo-workspace');

    expect(
      permissions[demoRole.id]['synthetic-company'].canReadObjectRecords,
    ).toBe(true);
    expect(
      permissions[demoRole.id]['synthetic-company'].canUpdateObjectRecords,
    ).toBe(false);
    expect(
      permissions[ordinaryRole.id]['workspace-member'].canReadObjectRecords,
    ).toBe(true);
  });
});
