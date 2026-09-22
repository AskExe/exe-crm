import {
  validateOperationIsPermittedOrThrow,
  validateQueryIsPermittedOrThrow,
} from 'src/engine/twenty-orm/repository/permissions.utils';
import { PermissionsException } from 'src/engine/metadata-modules/permissions/permissions.exception';

const SYSTEM_OBJECT_ID = 'system-object-id';
const SYSTEM_OBJECT_NAME = 'workspaceMember';

const flatObjectMetadataMaps = {
  byUniversalIdentifier: {
    'system-object-universal-id': {
      id: SYSTEM_OBJECT_ID,
      universalIdentifier: 'system-object-universal-id',
      isSystem: true,
      fieldIds: [],
    },
  },
  universalIdentifierById: {
    [SYSTEM_OBJECT_ID]: 'system-object-universal-id',
  },
};

const flatFieldMetadataMaps = {
  byUniversalIdentifier: {},
  universalIdentifierById: {},
};

const permission = (canRead: boolean) => ({
  canReadObjectRecords: canRead,
  canUpdateObjectRecords: false,
  canSoftDeleteObjectRecords: false,
  canDestroyObjectRecords: false,
  restrictedFields: {},
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
});

const validate = (
  operationType:
    | 'select'
    | 'insert'
    | 'update'
    | 'delete'
    | 'restore'
    | 'soft-delete',
  canRead = false,
) =>
  validateOperationIsPermittedOrThrow({
    entityName: SYSTEM_OBJECT_NAME,
    operationType,
    objectsPermissions: {
      [SYSTEM_OBJECT_ID]: permission(canRead),
    },
    flatObjectMetadataMaps: flatObjectMetadataMaps as never,
    flatFieldMetadataMaps: flatFieldMetadataMaps as never,
    objectIdByNameSingular: {
      [SYSTEM_OBJECT_NAME]: SYSTEM_OBJECT_ID,
    },
    selectedColumns: [],
    allFieldsSelected: false,
    updatedColumns: [],
  });

describe('system-object query authorization', () => {
  it('denies a system-object read when the role cache denies it', () => {
    expect(() => validate('select')).toThrow(PermissionsException);
  });

  it.each(['insert', 'update', 'delete', 'restore', 'soft-delete'] as const)(
    'denies the %s operation even when system-object reads are allowed',
    (operationType) => {
      expect(() => validate(operationType, true)).toThrow(PermissionsException);
    },
  );

  it('allows a system-object read when the role cache explicitly allows it', () => {
    expect(() => validate('select', true)).not.toThrow();
  });

  it('denies the system-object read through the ORM query guard', () => {
    expect(() =>
      validateQueryIsPermittedOrThrow({
        expressionMap: {
          aliases: [{ metadata: { name: SYSTEM_OBJECT_NAME } }],
          queryType: 'select',
          selects: [],
          joinAttributes: [],
          returning: undefined,
          valuesSet: undefined,
        } as never,
        objectsPermissions: {
          [SYSTEM_OBJECT_ID]: permission(false),
        },
        flatObjectMetadataMaps: flatObjectMetadataMaps as never,
        flatFieldMetadataMaps: flatFieldMetadataMaps as never,
        objectIdByNameSingular: {
          [SYSTEM_OBJECT_NAME]: SYSTEM_OBJECT_ID,
        },
        shouldBypassPermissionChecks: false,
      }),
    ).toThrow(PermissionsException);
  });
});
