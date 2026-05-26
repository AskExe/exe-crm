import { DeleteMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/DeleteMultipleRecordsCommand';
import { DestroyMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/DestroyMultipleRecordsCommand';
import { ExportMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/ExportMultipleRecordsCommand';
import { MergeMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/MergeMultipleRecordsCommand';
import { RestoreMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/RestoreMultipleRecordsCommand';
import { UpdateMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/UpdateMultipleRecordsCommand';
import { MultipleRecordsCommandKeys } from '@/command-menu-item/record/multiple-records/types/MultipleRecordsCommandKeys';
import { type CommandMenuItemConfig } from '@/command-menu-item/types/CommandMenuItemConfig';
import { CommandMenuItemScope } from '@/command-menu-item/types/CommandMenuItemScope';
import { CommandMenuItemType } from '@/command-menu-item/types/CommandMenuItemType';
import { msg } from '@lingui/core/macro';
import {
  BACKEND_BATCH_REQUEST_MAX_COUNT,
  MUTATION_MAX_MERGE_RECORDS,
} from 'twenty-shared/constants';
import { CommandMenuItemViewType } from 'twenty-shared/types';
import {
  IconArrowMerge,
  IconEdit,
  IconFileExport,
  IconRefresh,
  IconTrash,
  IconTrashX,
} from 'twenty-ui/display';
import { isDefined } from 'twenty-shared/utils';
import { PermissionFlagType } from '~/generated-metadata/graphql';

export const MULTIPLE_RECORDS_COMMAND_MENU_ITEMS_CONFIG: Record<
  MultipleRecordsCommandKeys,
  CommandMenuItemConfig
> = {
  [MultipleRecordsCommandKeys.DELETE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.DELETE,
    label: msg`Delete records`,
    shortLabel: msg`Delete`,
    position: 4,
    Icon: IconTrash,
    accent: 'default',
    isPinned: true,
    shouldBeRegistered: ({
      objectPermissions,
      isRemote,
      hasAnySoftDeleteFilterOnView,
      numberOfSelectedRecords,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        objectPermissions.canSoftDeleteObjectRecords &&
        !isRemote &&
        !hasAnySoftDeleteFilterOnView &&
        isDefined(numberOfSelectedRecords) &&
        numberOfSelectedRecords < BACKEND_BATCH_REQUEST_MAX_COUNT) ??
      false,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <DeleteMultipleRecordsCommand />,
  },
  [MultipleRecordsCommandKeys.RESTORE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.RESTORE,
    label: msg`Restore records`,
    shortLabel: msg`Restore`,
    position: 6,
    Icon: IconRefresh,
    accent: 'default',
    isPinned: true,
    shouldBeRegistered: ({
      objectPermissions,
      isRemote,
      hasAnySoftDeleteFilterOnView,
      numberOfSelectedRecords,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        objectPermissions.canSoftDeleteObjectRecords &&
        !isRemote &&
        isDefined(hasAnySoftDeleteFilterOnView) &&
        hasAnySoftDeleteFilterOnView &&
        isDefined(numberOfSelectedRecords) &&
        numberOfSelectedRecords < BACKEND_BATCH_REQUEST_MAX_COUNT) ??
      false,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <RestoreMultipleRecordsCommand />,
  },
  [MultipleRecordsCommandKeys.DESTROY]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.DESTROY,
    label: msg`Permanently destroy records`,
    shortLabel: msg`Destroy`,
    position: 8,
    Icon: IconTrashX,
    accent: 'danger',
    isPinned: true,
    shouldBeRegistered: ({
      objectPermissions,
      isRemote,
      hasAnySoftDeleteFilterOnView,
      numberOfSelectedRecords,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        objectPermissions.canDestroyObjectRecords &&
        !isRemote &&
        isDefined(hasAnySoftDeleteFilterOnView) &&
        hasAnySoftDeleteFilterOnView &&
        isDefined(numberOfSelectedRecords) &&
        numberOfSelectedRecords < BACKEND_BATCH_REQUEST_MAX_COUNT) ??
      false,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <DestroyMultipleRecordsCommand />,
  },
  [MultipleRecordsCommandKeys.UPDATE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.UPDATE,
    label: msg`Update records`,
    shortLabel: msg`Update`,
    position: 14,
    Icon: IconEdit,
    accent: 'default',
    isPinned: true,
    shouldBeRegistered: ({ objectPermissions, isRemote, objectMetadataItem }) =>
      !objectMetadataItem?.isSystem &&
      objectPermissions.canUpdateObjectRecords &&
      !isRemote,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <UpdateMultipleRecordsCommand />,
  },
  [MultipleRecordsCommandKeys.MERGE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.MERGE,
    label: msg`Merge records`,
    shortLabel: msg`Merge`,
    position: 15,
    Icon: IconArrowMerge,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({
      objectMetadataItem,
      numberOfSelectedRecords,
      objectPermissions,
    }) =>
      isDefined(objectMetadataItem?.duplicateCriteria) &&
      isDefined(numberOfSelectedRecords) &&
      Boolean(objectPermissions.canUpdateObjectRecords) &&
      Boolean(objectPermissions.canDestroyObjectRecords) &&
      numberOfSelectedRecords <= MUTATION_MAX_MERGE_RECORDS,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <MergeMultipleRecordsCommand />,
  },
  [MultipleRecordsCommandKeys.EXPORT]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: MultipleRecordsCommandKeys.EXPORT,
    label: msg`Export records`,
    shortLabel: msg`Export`,
    position: 16,
    Icon: IconFileExport,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: () => true,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION],
    component: <ExportMultipleRecordsCommand />,
    requiredPermissionFlag: PermissionFlagType.EXPORT_CSV,
  },
};
