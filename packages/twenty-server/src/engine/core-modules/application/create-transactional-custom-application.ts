import { FileFolder } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type QueryRunner } from 'typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { getDefaultApplicationPackageFields } from 'src/engine/core-modules/application/application-package/utils/get-default-application-package-fields.util';
import { parseAvailablePackagesFromPackageJsonAndYarnLock } from 'src/engine/core-modules/application/application-package/utils/parse-available-packages-from-package-json-and-yarn-lock.util';
import { type PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { ValidatedStorageDriver } from 'src/engine/core-modules/file-storage/drivers/validated-storage.driver';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { writeTransactionalApplicationFile } from 'src/engine/core-modules/file-storage/write-transactional-application-file';
import { logicFunctionCreateHash } from 'src/engine/metadata-modules/logic-function/utils/logic-function-create-hash.utils';

// Real transaction-only custom application path shared by ordinary signup and
// the unmounted private command. No cache/resolver/token service graph needed.
export async function createTransactionalCustomApplication(
  params: {
    workspaceId: string;
    applicationId: string;
    workspaceDisplayName?: string;
  },
  queryRunner: QueryRunner,
  writer: FileStorageService | ValidatedStorageDriver,
  privateFence?: PrivateNativeMutationFence,
): Promise<ApplicationEntity> {
  // Private composition uses only its explicitly constructed local driver;
  // ordinary service callers retain their dynamic factory selection.
  if (privateFence && writer instanceof FileStorageService) {
    throw new PrivateNativeActionUnavailable();
  }
  if (privateFence) await privateFence.assertCurrent();
  const initialFields = await getDefaultApplicationPackageFields();
  if (privateFence) await privateFence.assertCurrent();
  privateFence?.assertOriginalDeadline();
  const application = await queryRunner.manager.save(
    ApplicationEntity,
    queryRunner.manager.create(ApplicationEntity, {
      description: 'Workspace custom application',
      name: `${isDefined(params.workspaceDisplayName) ? params.workspaceDisplayName : 'Workspace'}'s custom application`,
      sourcePath: 'workspace-custom',
      version: '1.0.0',
      universalIdentifier: params.applicationId,
      workspaceId: params.workspaceId,
      id: params.applicationId,
      logicFunctionLayerId: null,
      canBeUninstalled: false,
      packageJsonChecksum: initialFields.packageJsonChecksum,
      packageJsonFileId: null,
      yarnLockChecksum: initialFields.yarnLockChecksum,
      yarnLockFileId: null,
      availablePackages: initialFields.availablePackages,
    }),
  );
  if (privateFence) await privateFence.assertCurrent();
  // Preserve the original separate package-fields read used by upload.
  const fields = await getDefaultApplicationPackageFields();
  if (privateFence) await privateFence.assertCurrent();
  const packageJsonChecksum = logicFunctionCreateHash(
    JSON.stringify(JSON.parse(fields.packageJsonContent)),
  );
  const yarnLockChecksum = logicFunctionCreateHash(fields.yarnLockContent);
  const availablePackages = parseAvailablePackagesFromPackageJsonAndYarnLock(
    fields.packageJsonContent,
    fields.yarnLockContent,
  );
  const shared = {
    mimeType: undefined,
    fileFolder: FileFolder.Dependencies,
    applicationUniversalIdentifier: application.universalIdentifier,
    workspaceId: application.workspaceId,
    settings: { isTemporaryFile: false, toDelete: false },
  };
  const packageParams = {
    ...shared,
    sourceFile: fields.packageJsonContent,
    resourcePath: 'package.json',
  };
  const packageJsonFile =
    writer instanceof FileStorageService
      ? await writer.writeFile({ ...packageParams, queryRunner })
      : await writeTransactionalApplicationFile(
          writer,
          queryRunner,
          packageParams,
          privateFence,
        );
  if (privateFence) await privateFence.assertCurrent();
  const yarnParams = {
    ...shared,
    sourceFile: fields.yarnLockContent,
    resourcePath: 'yarn.lock',
  };
  const yarnLockFile =
    writer instanceof FileStorageService
      ? await writer.writeFile({ ...yarnParams, queryRunner })
      : await writeTransactionalApplicationFile(
          writer,
          queryRunner,
          yarnParams,
          privateFence,
        );
  if (privateFence) await privateFence.assertCurrent();
  privateFence?.assertOriginalDeadline();
  await queryRunner.manager.update(
    ApplicationEntity,
    { id: application.id },
    {
      packageJsonFileId: packageJsonFile.id,
      yarnLockFileId: yarnLockFile.id,
      packageJsonChecksum,
      yarnLockChecksum,
      availablePackages,
    },
  );
  if (privateFence) await privateFence.assertCurrent();
  return application;
}
