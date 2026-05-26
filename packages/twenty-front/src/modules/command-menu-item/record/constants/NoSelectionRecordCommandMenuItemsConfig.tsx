import { CommandLink } from '@/command-menu-item/display/components/CommandLink';
import { CreateNewIndexRecordNoSelectionRecordCommand } from '@/command-menu-item/record/no-selection/components/CreateNewIndexRecordNoSelectionRecordCommand';
import { CreateNewViewNoSelectionRecordCommand } from '@/command-menu-item/record/no-selection/components/CreateNewViewNoSelectionRecordCommand';
import { HideDeletedRecordsNoSelectionRecordCommand } from '@/command-menu-item/record/no-selection/components/HideDeletedRecordsNoSelectionRecordCommand';
import { ImportRecordsNoSelectionRecordCommand } from '@/command-menu-item/record/no-selection/components/ImportRecordsNoSelectionRecordCommand';
import { SeeDeletedRecordsNoSelectionRecordCommand } from '@/command-menu-item/record/no-selection/components/SeeDeletedRecordsNoSelectionRecordCommand';
import { ExportMultipleRecordsCommand } from '@/command-menu-item/record/multiple-records/components/ExportMultipleRecordsCommand';
import { NoSelectionRecordCommandKeys } from '@/command-menu-item/record/no-selection/types/NoSelectionRecordCommandKeys';
import { type CommandMenuItemConfig } from '@/command-menu-item/types/CommandMenuItemConfig';
import { CommandMenuItemScope } from '@/command-menu-item/types/CommandMenuItemScope';
import { CommandMenuItemType } from '@/command-menu-item/types/CommandMenuItemType';
import { CoreObjectNamePlural } from '@/object-metadata/types/CoreObjectNamePlural';
import { msg } from '@lingui/core/macro';
import {
  AppPath,
  CommandMenuItemViewType,
  CoreObjectNameSingular,
  SettingsPath,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  IconBuildingSkyscraper,
  IconCheckbox,
  IconEyeOff,
  IconFileExport,
  IconFileImport,
  IconLayout,
  IconLayoutDashboard,
  IconPlus,
  IconRotate2,
  IconSettings,
  IconSettingsAutomation,
  IconTargetArrow,
  IconUser,
} from 'twenty-ui/display';
import { PermissionFlagType } from '~/generated-metadata/graphql';

export const NO_SELECTION_RECORD_COMMAND_MENU_ITEMS_CONFIG: Record<
  NoSelectionRecordCommandKeys,
  CommandMenuItemConfig
> = {
  [NoSelectionRecordCommandKeys.CREATE_NEW_RECORD]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.CREATE_NEW_RECORD,
    label: msg`Create new record`,
    shortLabel: msg`New record`,
    position: 2,
    isPinned: true,
    Icon: IconPlus,
    shouldBeRegistered: ({
      objectMetadataItem,
      objectPermissions,
      hasAnySoftDeleteFilterOnView,
    }) =>
      (!objectMetadataItem?.isSystem &&
        objectPermissions.canUpdateObjectRecords &&
        !hasAnySoftDeleteFilterOnView) ??
      false,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <CreateNewIndexRecordNoSelectionRecordCommand />,
  },
  [NoSelectionRecordCommandKeys.IMPORT_RECORDS]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.IMPORT_RECORDS,
    label: msg`Import records`,
    shortLabel: msg`Import`,
    position: 17,
    Icon: IconFileImport,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({
      objectMetadataItem,
      hasAnySoftDeleteFilterOnView,
    }) => !objectMetadataItem?.isSystem && !hasAnySoftDeleteFilterOnView,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <ImportRecordsNoSelectionRecordCommand />,
    requiredPermissionFlag: PermissionFlagType.IMPORT_CSV,
  },
  [NoSelectionRecordCommandKeys.EXPORT_VIEW]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.EXPORT_VIEW,
    label: msg`Export view`,
    shortLabel: msg`Export`,
    position: 18,
    Icon: IconFileExport,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: () => true,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <ExportMultipleRecordsCommand />,
    requiredPermissionFlag: PermissionFlagType.EXPORT_CSV,
  },
  [NoSelectionRecordCommandKeys.SEE_DELETED_RECORDS]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.SEE_DELETED_RECORDS,
    label: msg`See deleted records`,
    shortLabel: msg`Deleted records`,
    position: 19,
    Icon: IconRotate2,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({ hasAnySoftDeleteFilterOnView }) =>
      !hasAnySoftDeleteFilterOnView,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <SeeDeletedRecordsNoSelectionRecordCommand />,
  },
  [NoSelectionRecordCommandKeys.CREATE_NEW_VIEW]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.CREATE_NEW_VIEW,
    label: msg`Create View`,
    shortLabel: msg`Create View`,
    position: 20,
    Icon: IconLayout,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({ hasAnySoftDeleteFilterOnView }) =>
      !hasAnySoftDeleteFilterOnView,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <CreateNewViewNoSelectionRecordCommand />,
  },
  [NoSelectionRecordCommandKeys.HIDE_DELETED_RECORDS]: {
    type: CommandMenuItemType.Standard,
    scope: CommandMenuItemScope.Object,
    key: NoSelectionRecordCommandKeys.HIDE_DELETED_RECORDS,
    label: msg`Hide deleted records`,
    shortLabel: msg`Hide deleted`,
    position: 21,
    Icon: IconEyeOff,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({ hasAnySoftDeleteFilterOnView }) =>
      isDefined(hasAnySoftDeleteFilterOnView) && hasAnySoftDeleteFilterOnView,
    availableOn: [CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION],
    component: <HideDeletedRecordsNoSelectionRecordCommand />,
  },
  [NoSelectionRecordCommandKeys.GO_TO_WORKFLOWS]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_WORKFLOWS,
    label: msg`Go to Workflows`,
    shortLabel: msg`See Workflows`,
    position: 22,
    Icon: IconSettingsAutomation,
    accent: 'default',
    isPinned: false,
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Workflow) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Workflow ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Workflow }}
      />
    ),
    hotKeys: ['G', 'W'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_PEOPLE]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_PEOPLE,
    label: msg`Go to People`,
    shortLabel: msg`People`,
    position: 23,
    Icon: IconUser,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Person) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Person ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Person }}
      />
    ),
    hotKeys: ['G', 'P'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_COMPANIES]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_COMPANIES,
    label: msg`Go to Companies`,
    shortLabel: msg`Companies`,
    position: 24,
    Icon: IconBuildingSkyscraper,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Company) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Company ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Company }}
      />
    ),
    hotKeys: ['G', 'C'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_DASHBOARDS]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_DASHBOARDS,
    label: msg`Go to Dashboards`,
    shortLabel: msg`Dashboards`,
    position: 25,
    Icon: IconLayoutDashboard,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Dashboard) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Dashboard ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Dashboard }}
      />
    ),
    hotKeys: ['G', 'D'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_OPPORTUNITIES]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_OPPORTUNITIES,
    label: msg`Go to Opportunities`,
    shortLabel: msg`Opportunities`,
    position: 26,
    Icon: IconTargetArrow,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Opportunity) &&
      (objectMetadataItem?.nameSingular !==
        CoreObjectNameSingular.Opportunity ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Opportunity }}
      />
    ),
    hotKeys: ['G', 'O'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_SETTINGS]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_SETTINGS,
    label: msg`Go to Settings`,
    shortLabel: msg`Settings`,
    position: 27,
    Icon: IconSettings,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
    ],
    shouldBeRegistered: () => true,
    component: (
      <CommandLink
        to={AppPath.SettingsCatchAll}
        params={{
          '*': SettingsPath.ProfilePage,
        }}
      />
    ),
    hotKeys: ['G', 'S'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_TASKS]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_TASKS,
    label: msg`Go to Tasks`,
    shortLabel: msg`Tasks`,
    position: 28,
    Icon: IconCheckbox,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Task) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Task ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Task }}
      />
    ),
    hotKeys: ['G', 'T'],
  },
  [NoSelectionRecordCommandKeys.GO_TO_NOTES]: {
    type: CommandMenuItemType.Navigation,
    scope: CommandMenuItemScope.Global,
    key: NoSelectionRecordCommandKeys.GO_TO_NOTES,
    label: msg`Go to Notes`,
    shortLabel: msg`Notes`,
    position: 29,
    Icon: IconCheckbox,
    isPinned: false,
    availableOn: [
      CommandMenuItemViewType.INDEX_PAGE_NO_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_SINGLE_RECORD_SELECTION,
      CommandMenuItemViewType.INDEX_PAGE_BULK_SELECTION,
      CommandMenuItemViewType.SHOW_PAGE,
      CommandMenuItemViewType.PAGE_EDIT_MODE,
    ],
    shouldBeRegistered: ({
      objectMetadataItem,
      viewType,
      getTargetObjectReadPermission,
    }) =>
      getTargetObjectReadPermission(CoreObjectNameSingular.Note) &&
      (objectMetadataItem?.nameSingular !== CoreObjectNameSingular.Note ||
        viewType === CommandMenuItemViewType.SHOW_PAGE),
    component: (
      <CommandLink
        to={AppPath.RecordIndexPage}
        params={{ objectNamePlural: CoreObjectNamePlural.Note }}
      />
    ),
    hotKeys: ['G', 'N'],
  },
};
