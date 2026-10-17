import { join } from 'node:path';

import { type QueryRunner } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { type PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { type StorageDriver } from 'src/engine/core-modules/file-storage/drivers/interfaces/storage-driver.interface';
import { type ResourceIdentifier } from 'src/engine/core-modules/file-storage/file-storage.service';
import { type FileSettings } from 'src/engine/core-modules/file/types/file-settings.types';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';

// The transaction-only branch of FileStorageService.writeFile. Its external
// driver write is not rolled back by the SQL transaction.
export async function writeTransactionalApplicationFile(
  driver: StorageDriver,
  queryRunner: QueryRunner,
  params: ResourceIdentifier & {
    sourceFile: string | Buffer | Uint8Array;
    mimeType: string | undefined;
    fileId?: string;
    settings: FileSettings;
  },
  privateFence?: PrivateNativeMutationFence,
): Promise<FileEntity> {
  if (privateFence) await privateFence.assertCurrent();
  const applicationRepository =
    queryRunner.manager.getRepository(ApplicationEntity);
  const fileRepository = queryRunner.manager.getRepository(FileEntity);
  const application = await applicationRepository.findOneOrFail({
    where: {
      universalIdentifier: params.applicationUniversalIdentifier,
      workspaceId: params.workspaceId,
    },
  });
  if (privateFence) await privateFence.assertCurrent();
  const onStoragePath = join(
    params.workspaceId,
    params.applicationUniversalIdentifier,
    params.fileFolder,
    params.resourcePath,
  ).replace(/\/+/g, '/');
  privateFence?.assertOriginalDeadline();
  await driver.writeFile({
    filePath: onStoragePath,
    mimeType: params.mimeType,
    sourceFile: params.sourceFile,
  });
  if (privateFence) await privateFence.assertCurrent();
  privateFence?.assertOriginalDeadline();
  const fileFields = {
    path: `${params.fileFolder}/${params.resourcePath}`,
    workspaceId: params.workspaceId,
    applicationId: application.id,
    id: params.fileId,
    mimeType: params.mimeType,
    size:
      typeof params.sourceFile === 'string'
        ? Buffer.byteLength(params.sourceFile)
        : params.sourceFile.length,
    settings: params.settings,
  };
  if (privateFence) {
    // A fresh private action cannot update or adopt a conflicting file key.
    // INSERT failure stays uncertain; the committed native marker survives.
    await fileRepository.insert(fileFields);
  } else {
    await fileRepository.upsert(fileFields, [
      'path',
      'workspaceId',
      'applicationId',
    ]);
  }
  if (privateFence) await privateFence.assertCurrent();
  const file = await fileRepository.findOneOrFail({
    where: {
      path: `${params.fileFolder}/${params.resourcePath}`,
      applicationId: application.id,
      workspaceId: params.workspaceId,
    },
  });
  if (privateFence) await privateFence.assertCurrent();
  return file;
}
