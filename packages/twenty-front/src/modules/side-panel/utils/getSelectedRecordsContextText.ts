import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { getObjectRecordIdentifier } from '@/object-metadata/utils/getObjectRecordIdentifier';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';

export const getSelectedRecordsContextText = (
  objectMetadataItem: EnrichedObjectMetadataItem,
  records: ObjectRecord[],
  totalCount: number,
  allowRequestsToExeIcons: boolean,
) => {
  return totalCount === 1
    ? getObjectRecordIdentifier({
        objectMetadataItem,
        record: records[0],
        allowRequestsToExeIcons,
      }).name
    : `${totalCount} ${objectMetadataItem.labelPlural}`;
};
