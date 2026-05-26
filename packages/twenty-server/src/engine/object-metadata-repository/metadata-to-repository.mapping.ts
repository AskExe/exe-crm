import { BlocklistRepository } from 'src/modules/blocklist/repositories/blocklist.repository';
import { TimelineActivityRepository } from 'src/modules/timeline/repositories/timeline-activity.repository';

// oxlint-disable-next-line @typescripttypescript/no-explicit-any
export const metadataToRepositoryMapping: Record<string, any> = {
  BlocklistWorkspaceEntity: BlocklistRepository,
  TimelineActivityWorkspaceEntity: TimelineActivityRepository,
};
