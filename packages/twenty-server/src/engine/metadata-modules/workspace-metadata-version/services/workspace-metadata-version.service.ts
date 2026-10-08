import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { PrivateNativeStructuralAdapter } from 'src/engine/core-modules/company-native-bootstrap/private-native-structural-adapter';
import { type PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import {
  WorkspaceMetadataVersionException,
  WorkspaceMetadataVersionExceptionCode,
} from 'src/engine/metadata-modules/workspace-metadata-version/exceptions/workspace-metadata-version.exception';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

@Injectable()
export class WorkspaceMetadataVersionService {
  logger = new Logger(WorkspaceMetadataVersionService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly workspaceCacheStorageService: WorkspaceCacheStorageService,
  ) {}

  async incrementMetadataVersion(
    workspaceId: string,
    privateFence?: PrivateNativeMutationFence,
    privateStructuralAdapter?: PrivateNativeStructuralAdapter,
  ): Promise<void> {
    if (privateStructuralAdapter) {
      PrivateNativeStructuralAdapter.assertIssued(privateStructuralAdapter);
      if (privateFence) privateStructuralAdapter.assertFence(privateFence);
      const newMetadataVersion =
        await privateStructuralAdapter.incrementMetadataVersion(workspaceId);
      await privateStructuralAdapter.assertWorkspaceCurrent(workspaceId);
      await this.workspaceCacheStorageService.setMetadataVersion(
        workspaceId,
        newMetadataVersion,
      );
      await privateStructuralAdapter.assertWorkspaceCurrent(workspaceId);
      return;
    }
    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
      withDeleted: true,
    });

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    const metadataVersion = workspace?.metadataVersion;

    if (!isDefined(metadataVersion)) {
      throw new WorkspaceMetadataVersionException(
        'Metadata version not found',
        WorkspaceMetadataVersionExceptionCode.METADATA_VERSION_NOT_FOUND,
      );
    }

    const newMetadataVersion = metadataVersion + 1;

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    await this.workspaceRepository.update(
      { id: workspaceId },
      { metadataVersion: newMetadataVersion },
    );

    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
    await this.workspaceCacheStorageService.setMetadataVersion(
      workspaceId,
      newMetadataVersion,
    );
    if (privateFence) await privateFence.assertWorkspaceCurrent(workspaceId);
  }
}
