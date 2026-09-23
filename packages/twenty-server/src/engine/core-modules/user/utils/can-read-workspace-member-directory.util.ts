import { IsNull, type Repository } from 'typeorm';

import { type KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';

const DEMO_BOOTSTRAP_MARKER_KEY = 'exe.demo-workspace-bootstrap.v1';

export const canReadWorkspaceMemberDirectory = async ({
  keyValuePairRepository,
  userId,
  workspaceId,
}: {
  keyValuePairRepository: Repository<KeyValuePairEntity>;
  userId: string | undefined;
  workspaceId: string;
}): Promise<boolean> => {
  const marker = await keyValuePairRepository.findOne({
    where: {
      workspaceId,
      userId: IsNull(),
      key: DEMO_BOOTSTRAP_MARKER_KEY,
      deletedAt: IsNull(),
    },
  });

  if (!marker) {
    // A configured DEMO remains private even before bootstrap completes.
    return workspaceId !== process.env.EXE_DEMO_WORKSPACE_ID;
  }

  // Persisted marker remains the privacy boundary if admission is disabled
  // or its environment variable is later pointed at another workspace.
  const value = marker.value;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const ownerUserIds = (value as { ownerUserIds?: unknown }).ownerUserIds;

  return (
    Array.isArray(ownerUserIds) &&
    ownerUserIds.length === 2 &&
    ownerUserIds.every(
      (ownerUserId) =>
        typeof ownerUserId === 'string' && ownerUserId.length > 0,
    ) &&
    new Set(ownerUserIds).size === 2 &&
    ownerUserIds.includes(userId)
  );
};
