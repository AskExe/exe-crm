import deepEqual from 'deep-equal';
import { type ObjectRecord } from 'twenty-shared/types';

import { type BaseWorkspaceEntity } from 'src/engine/twenty-orm/base.workspace-entity';

export const objectRecordChangedProperties = <
  PRecord extends Partial<ObjectRecord | BaseWorkspaceEntity> =
    Partial<ObjectRecord>,
>(
  oldRecord: PRecord,
  newRecord: PRecord,
) => {
  const changedProperties = Object.keys(newRecord).filter(
    (key) =>
      !deepEqual(
        (oldRecord as Record<string, unknown>)[key],
        (newRecord as Record<string, unknown>)[key],
      ),
  );

  return changedProperties;
};
