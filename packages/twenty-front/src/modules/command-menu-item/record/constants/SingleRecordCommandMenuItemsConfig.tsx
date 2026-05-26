import { CommandLink } from '@/command-menu-item/display/components/CommandLink';
import { DeleteSingleRecordCommand } from '@/command-menu-item/record/single-record/components/DeleteSingleRecordCommand';
import { DestroySingleRecordCommand } from '@/command-menu-item/record/single-record/components/DestroySingleRecordCommand';
import { ExportNoteSingleRecordCommand } from '@/command-menu-item/record/single-record/components/ExportNoteSingleRecordCommand';
import { ExportSingleRecordCommand } from '@/command-menu-item/record/single-record/components/ExportSingleRecordCommand';
import { NavigateToNextRecordSingleRecordCommand } from '@/command-menu-item/record/single-record/components/NavigateToNextRecordSingleRecordCommand';
import { NavigateToPreviousRecordSingleRecordCommand } from '@/command-menu-item/record/single-record/components/NavigateToPreviousRecordSingleRecordCommand';
import { AddToFavoritesSingleRecordCommand } from '@/command-menu-item/record/single-record/components/AddToFavoritesSingleRecordCommand';
import { RemoveFromFavoritesSingleRecordCommand } from '@/command-menu-item/record/single-record/components/RemoveFromFavoritesSingleRecordCommand';
import { RestoreSingleRecordCommand } from '@/command-menu-item/record/single-record/components/RestoreSingleRecordCommand';
import { EditRecordPageLayoutSingleRecordCommand } from '@/command-menu-item/record/single-record/record-page-layout/components/EditRecordPageLayoutSingleRecordCommand';
import { ExportMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/ExportMultipleRecordsCommand';
import { RecordPageLayoutSingleRecordCommandKeys } from '@/command-menu-item/record/single-record/record-page-layout/types/RecordPageLayoutSingleRecordCommandKeys';
import { SingleRecordCommandKeys } from '@/command-menu-item/record/single-record/types/SingleRecordCommandKeys';
import { type CommandMenuItemConfig } from '@/command-menu-item/types/CommandMenuItemConfig';
import { CommandMenuItemScope } from '@/command-menu-item/types/CommandMenuItemScope';
import { CommandMenuItemType } from '@/command-menu-item/types/CommandMenuItemType';
import {
  CoreObjectNameSingular,
  CommandMenuItemViewType,
} from 'twenty-shared/types';
import { msg } from '@lingui/core/macro';
import { isNonEmptyString } from '@sniptt/guards';
import {
  IconChevronDown,
  IconChevronUp,
  IconFileExport,
  IconHeart,
  IconHeartOff,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconTrashX,
} from 'twenty-ui/display';
import { isDefined } from 'twenty-shared/utils';
import {
  FeatureFlagKey,
  PermissionFlagType,
} from '~/generated-metadata/graphql';

export const SINGLE_RECORD_COMMAND_MENU_ITEMS_CONFIG: Record<
  SingleRecordCommandKeys | RecordPageLayoutSingleRecordCommandKeys,
  CommandMenuItemConfig
> = {
  [SingleRecordCommandKeys.NAVIGATE_TO_NEXT_RECORD]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.NAVIGATE_TO_NEXT_RECORD,
    label: msg`Navigate to next record`,
    position: 0,
    isPinned: true,
    Icon: IconChevronDown,
    shouldBeRegistered: ({ isInSidePanel }) => !isInSidePanel,
    availableOn: [CommandMenuItemViewType.SHOW_PAGE],
    component: <NavigateToNextRecordSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.NAVIGATE_TO_PREVIOUS_RECORD]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.NAVIGATE_TO_PREVIOUS_RECORD,
    label: msg`Navigate to previous record`,
    position: 1,
    isPinned: true,
    Icon: IconChevronUp,
    shouldBeRegistered: ({ isInSidePanel }) => !isInSidePanel,
    availableOn: [CommandMenuItemViewType.SHOW_PAGE],
    component: <NavigateToPreviousRecordSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.DELETE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.DELETE,
    label: msg`Delete`,
    shortLabel: msg`Delete`,
    position: 3,
    Icon: IconTrash,
    accent: 'default',
    isPinned: true,
    shouldBeRegistered: ({
      selectedRecord,
      hasAnySoftDeleteFilterOnView,
      objectPermissions,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        isDefined(selectedRecord) &&
        !selectedRecord.isRemote &&
        !hasAnySoftDeleteFilterOnView &&
        objectPermissions.canSoftDeleteObjectRecords &&
        !isDefined(selectedRecord?.deletedAt)) ??
      false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <DeleteSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.RESTORE]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.RESTORE,
    label: msg`Restore record`,
    shortLabel: msg`Restore`,
    position: 5,
    Icon: IconRefresh,
    accent: 'default',
    isPinned: true,
    shouldBeRegistered: ({
      selectedRecord,
      objectPermissions,
      isRemote,
      isShowPage,
      hasAnySoftDeleteFilterOnView,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        !isRemote &&
        isDefined(selectedRecord?.deletedAt) &&
        objectPermissions.canSoftDeleteObjectRecords &&
        ((isDefined(isShowPage) && isShowPage) ||
          (isDefined(hasAnySoftDeleteFilterOnView) &&
            hasAnySoftDeleteFilterOnView))) ??
      false,
    availableOn: [
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
    ],
    component: <RestoreSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.DESTROY]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.DESTROY,
    label: msg`Permanently destroy record`,
    shortLabel: msg`Destroy`,
    position: 7,
    Icon: IconTrashX,
    accent: 'danger',
    isPinned: true,
    shouldBeRegistered: ({
      selectedRecord,
      objectPermissions,
      isRemote,
      objectMetadataItem,
    }) =>
      (!objectMetadataItem?.isSystem &&
        objectPermissions.canDestroyObjectRecords &&
        !isRemote &&
        isDefined(selectedRecord?.deletedAt)) ??
      false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <DestroySingleRecordCommand />,
  },
  [SingleRecordCommandKeys.ADD_TO_FAVORITES]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.ADD_TO_FAVORITES,
    label: msg`Add to favorites`,
    shortLabel: msg`Add to favorites`,
    position: 9,
    isPinned: true,
    Icon: IconHeart,
    shouldBeRegistered: ({
      selectedRecord,
      isFavorite,
      hasAnySoftDeleteFilterOnView,
      objectMetadataItem,
    }) =>
      !objectMetadataItem?.isSystem &&
      !selectedRecord?.isRemote &&
      !isFavorite &&
      !isDefined(selectedRecord?.deletedAt) &&
      !hasAnySoftDeleteFilterOnView,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <AddToFavoritesSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.REMOVE_FROM_FAVORITES]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.REMOVE_FROM_FAVORITES,
    label: msg`Remove from favorites`,
    shortLabel: msg`Remove from favorites`,
    isPinned: true,
    position: 10,
    Icon: IconHeartOff,
    shouldBeRegistered: ({
      selectedRecord,
      isFavorite,
      hasAnySoftDeleteFilterOnView,
      objectMetadataItem,
    }) =>
      !objectMetadataItem?.isSystem &&
      isDefined(selectedRecord) &&
      !selectedRecord?.isRemote &&
      isDefined(isFavorite) &&
      isFavorite &&
      !isDefined(selectedRecord?.deletedAt) &&
      !hasAnySoftDeleteFilterOnView,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    component: <RemoveFromFavoritesSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.EXPORT_NOTE_TO_PDF]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.EXPORT_NOTE_TO_PDF,
    label: msg`Export to PDF`,
    shortLabel: msg`Export`,
    position: 11,
    isPinned: false,
    Icon: IconFileExport,
    shouldBeRegistered: ({ selectedRecord, isNoteOrTask }) =>
      isDefined(isNoteOrTask) &&
      isNoteOrTask &&
      isNonEmptyString(selectedRecord?.bodyV2?.blocknote),
    availableOn: [CommandMenuItemViewType.SHOW_PAGE],
    component: <ExportNoteSingleRecordCommand />,
  },
  [SingleRecordCommandKeys.EXPORT_FROM_RECORD_INDEX]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.EXPORT_FROM_RECORD_INDEX,
    label: msg`Export`,
    shortLabel: msg`Export`,
    position: 12,
    Icon: IconFileExport,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({ selectedRecord }) =>
      isDefined(selectedRecord) && !selectedRecord.isRemote,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION],
    component: <ExportMultipleRecordsCommand />,
    requiredPermissionFlag: PermissionFlagType.EXPORT_CSV,
  },
  [SingleRecordCommandKeys.EXPORT_FROM_RECORD_SHOW]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    key: SingleRecordCommandKeys.EXPORT_FROM_RECORD_SHOW,
    label: msg`Export`,
    shortLabel: msg`Export`,
    position: 13,
    Icon: IconFileExport,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({ selectedRecord }) =>
      isDefined(selectedRecord) && !selectedRecord.isRemote,
    availableOn: [CommandMenuItemViewType.SHOW_PAGE],
    component: <ExportSingleRecordCommand />,
    requiredPermissionFlag: PermissionFlagType.EXPORT_CSV,
  },
  [RecordPageLayoutSingleRecordCommandKeys.EDIT_RECORD_PAGE_LAYOUT]: {
    key: RecordPageLayoutSingleRecordCommandKeys.EDIT_RECORD_PAGE_LAYOUT,
    label: msg`Edit Layout`,
    shortLabel: msg`Edit Layout`,
    isPinned: false,
    position: 30,
    Icon: IconPencil,
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.RecordSelection,
    requiredPermissionFlag: PermissionFlagType.LAYOUTS,
    shouldBeRegistered: ({
      selectedRecord,
      objectPermissions,
      objectMetadataItem,
      isFeatureFlagEnabled,
    }) =>
      isFeatureFlagEnabled(
        FeatureFlagKey.IS_RECORD_PAGE_LAYOUT_EDITING_ENABLED,
      ) &&
      isDefined(selectedRecord) &&
      !selectedRecord?.isRemote &&
      !isDefined(selectedRecord?.deletedAt) &&
      objectPermissions.canUpdateObjectRecords &&
      objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Dashboard,
    availableOn: [CommandMenuItemViewType.SHOW_PAGE],
    component: <EditRecordPageLayoutSingleRecordCommand />,
  },
};
