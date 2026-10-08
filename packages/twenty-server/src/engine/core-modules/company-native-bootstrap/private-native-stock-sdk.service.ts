import { printSchema } from 'graphql';
import { FileFolder } from 'twenty-shared/types';
import { type DataSource } from 'typeorm';

import { StockSdkSchemaFactory } from 'src/engine/api/graphql/stock-sdk-schema.factory';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeStockSdkChannel } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-channel';
import { PrivateNativeStockRoleGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-role-guard';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';

// Private graph override of the stock SDK token. Ordinary SDK generation and
// its native schema, file metadata and stale/cache semantics remain unchanged.
export class PrivateNativeStockSdkService {
  constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
    private readonly database: DataSource,
    private readonly control: PrivateNativeStockRoleGuard,
    private readonly schemaFactory: StockSdkSchemaFactory,
    private readonly channel: PrivateNativeStockSdkChannel,
    private readonly files: FileStorageService,
    private readonly cache: WorkspaceCacheService,
  ) {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    channel.assertCheckpoint(checkpoint);
  }

  async generateSdkClientForApplication(input: {
    workspaceId: string;
    applicationId: string;
    applicationUniversalIdentifier: string;
  }): Promise<Buffer> {
    const original = this.checkpoint.pendingPlan.original;
    await this.control.assertBusinessDatabase(this.database, this.checkpoint);
    await this.checkpoint.assertCurrent();
    if (input.workspaceId !== original.workspaceId)
      throw new PrivateNativeActionUnavailable();
    const applications = await this.database
      .getRepository(ApplicationEntity)
      .find({ where: { workspaceId: original.workspaceId } });
    await this.checkpoint.assertCurrent();
    const standard = applications.find(
      (application) =>
        application.universalIdentifier ===
        TWENTY_STANDARD_APPLICATION.universalIdentifier,
    );
    const custom = applications.find(
      (application) =>
        application.id === original.customApplicationId &&
        application.universalIdentifier === original.customApplicationId,
    );
    if (
      applications.length !== 2 ||
      !standard ||
      !custom ||
      standard.id === custom.id ||
      standard.name !== TWENTY_STANDARD_APPLICATION.name ||
      standard.version !== TWENTY_STANDARD_APPLICATION.version ||
      standard.sourcePath !== TWENTY_STANDARD_APPLICATION.sourcePath ||
      standard.canBeUninstalled !== false ||
      !standard.packageJsonFileId ||
      !standard.yarnLockFileId ||
      !standard.packageJsonChecksum ||
      !standard.yarnLockChecksum
    )
      throw new PrivateNativeActionUnavailable();
    const application =
      input.applicationId === standard.id
        ? standard
        : input.applicationId === custom.id
          ? custom
          : undefined;
    if (
      !application ||
      input.applicationUniversalIdentifier !== application.universalIdentifier
    )
      throw new PrivateNativeActionUnavailable();
    const snapshot = await this.checkpoint.readOriginalStockApplications();
    if (
      snapshot.standardApplicationId !== standard.id ||
      snapshot.customApplicationId !== custom.id
    )
      throw new PrivateNativeActionUnavailable();
    await this.channel.bindApplications(snapshot);
    const schema = await this.schemaFactory.createGraphQLSchema(
      { id: original.workspaceId } as FlatWorkspace,
      application.id,
    );
    await this.checkpoint.assertCurrent();
    const archive = await this.channel.generate(
      Object.freeze({
        version: 1,
        actionId: original.actionId,
        workspaceId: original.workspaceId,
        applicationId: application.id,
        applicationUniversalIdentifier: application.universalIdentifier,
        schema: printSchema(schema),
      }),
    );
    await this.checkpoint.assertCurrent();
    await this.files.writeFile({
      workspaceId: original.workspaceId,
      applicationUniversalIdentifier: application.universalIdentifier,
      fileFolder: FileFolder.GeneratedSdkClient,
      resourcePath: 'twenty-client-sdk.zip',
      sourceFile: archive,
      mimeType: 'application/zip',
      settings: { isTemporaryFile: false, toDelete: false },
    });
    await this.checkpoint.assertCurrent();
    const update = await this.database
      .getRepository(ApplicationEntity)
      .update(
        { id: application.id, workspaceId: original.workspaceId },
        { isSdkLayerStale: true },
      );
    await this.checkpoint.assertCurrent();
    if (update.affected !== 1) throw new PrivateNativeActionUnavailable();
    await this.cache.invalidateAndRecompute(original.workspaceId, [
      'flatApplicationMaps',
    ]);
    await this.checkpoint.assertCurrent();
    return archive;
  }
}
