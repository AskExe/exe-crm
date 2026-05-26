import { MultipleRecordsCommandKeys } from '@/command-menu-item/record/multiple-records/types/MultipleRecordsCommandKeys';
import { MULTIPLE_RECORDS_COMMAND_MENU_ITEMS_CONFIG } from '@/command-menu-item/record/constants/MultipleRecordsCommandMenuItemsConfig';
import { NO_SELECTION_RECORD_COMMAND_MENU_ITEMS_CONFIG } from '@/command-menu-item/record/constants/NoSelectionRecordCommandMenuItemsConfig';
import { SINGLE_RECORD_COMMAND_MENU_ITEMS_CONFIG } from '@/command-menu-item/record/constants/SingleRecordCommandMenuItemsConfig';
import { NoSelectionRecordCommandKeys } from '@/command-menu-item/record/no-selection/types/NoSelectionRecordCommandKeys';
import { RecordPageLayoutSingleRecordCommandKeys } from '@/command-menu-item/record/single-record/record-page-layout/types/RecordPageLayoutSingleRecordCommandKeys';
import { SingleRecordCommandKeys } from '@/command-menu-item/record/single-record/types/SingleRecordCommandKeys';
import { type CommandMenuItemConfig } from '@/command-menu-item/types/CommandMenuItemConfig';

export const DEFAULT_RECORD_COMMAND_MENU_ITEMS_CONFIG: Record<
  | NoSelectionRecordCommandKeys
  | SingleRecordCommandKeys
  | MultipleRecordsCommandKeys
  | RecordPageLayoutSingleRecordCommandKeys,
  CommandMenuItemConfig
> = {
  ...SINGLE_RECORD_COMMAND_MENU_ITEMS_CONFIG,
  ...MULTIPLE_RECORDS_COMMAND_MENU_ITEMS_CONFIG,
  ...NO_SELECTION_RECORD_COMMAND_MENU_ITEMS_CONFIG,
};
