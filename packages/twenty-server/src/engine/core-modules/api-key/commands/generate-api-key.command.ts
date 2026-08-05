import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { addDays } from 'date-fns';
import { Command, CommandRunner, Option } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';

type GenerateApiKeyCommandOptions = {
  workspaceId: string;
  name: string;
  expiresIn?: number;
  list?: boolean;
  revoke?: string;
};

const NEVER_EXPIRE_DAYS = 100 * 365;

@Command({
  name: 'workspace:generate-api-key',
  description:
    'Generate, list, or revoke API keys for a workspace. ' +
    'Outputs a bearer token that can be used with the CRM REST and GraphQL APIs.',
})
export class GenerateApiKeyCommand extends CommandRunner {
  private readonly logger = new Logger(GenerateApiKeyCommand.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(ApiKeyEntity)
    private readonly apiKeyRepository: Repository<ApiKeyEntity>,
    private readonly apiKeyService: ApiKeyService,
  ) {
    super();
  }

  @Option({
    flags: '-w, --workspace-id <workspaceId>',
    description: 'Workspace ID (required)',
    required: true,
  })
  parseWorkspaceId(value: string): string {
    return value;
  }

  @Option({
    flags: '-n, --name <name>',
    description: 'Name of the API key',
    defaultValue: 'CLI API Key',
  })
  parseName(value: string): string {
    return value;
  }

  @Option({
    flags: '-e, --expires-in <days>',
    description:
      'Number of days until expiration. Omit for a non-expiring key.',
  })
  parseExpiresIn(value: string): number {
    const days = parseInt(value, 10);

    if (isNaN(days) || days <= 0) {
      throw new Error('--expires-in must be a positive number of days');
    }

    return days;
  }

  @Option({
    flags: '-l, --list',
    description:
      'List all active API keys for the workspace instead of creating one',
  })
  parseList(value: boolean): boolean {
    return value ?? true;
  }

  @Option({
    flags: '-r, --revoke <apiKeyId>',
    description: 'Revoke an existing API key by its ID',
  })
  parseRevoke(value: string): string {
    return value;
  }

  async run(
    _passedParams: string[],
    options: GenerateApiKeyCommandOptions,
  ): Promise<void> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: options.workspaceId },
    });

    if (!isDefined(workspace)) {
      this.logger.error(`Workspace ${options.workspaceId} not found.`);

      return;
    }

    if (options.list) {
      await this.listApiKeys(workspace);

      return;
    }

    if (options.revoke) {
      await this.revokeApiKey(workspace, options.revoke);

      return;
    }

    await this.generateApiKey(workspace, options);
  }

  private async listApiKeys(workspace: WorkspaceEntity): Promise<void> {
    const apiKeys = await this.apiKeyRepository.find({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'DESC' },
    });

    if (apiKeys.length === 0) {
      this.logger.log('No API keys found for this workspace.');

      return;
    }

    this.logger.log(`\nAPI keys for workspace ${workspace.id}:\n`);
    this.logger.log(
      `${'ID'.padEnd(38)} ${'Name'.padEnd(24)} ${'Status'.padEnd(10)} ${'Expires'.padEnd(24)} Created`,
    );
    this.logger.log('-'.repeat(120));

    for (const key of apiKeys) {
      const status = this.apiKeyService.isRevoked(key)
        ? 'REVOKED'
        : this.apiKeyService.isExpired(key)
          ? 'EXPIRED'
          : 'ACTIVE';

      this.logger.log(
        `${key.id.padEnd(38)} ${key.name.padEnd(24)} ${status.padEnd(10)} ${key.expiresAt.toISOString().padEnd(24)} ${key.createdAt.toISOString()}`,
      );
    }

    const activeCount = apiKeys.filter((k) =>
      this.apiKeyService.isActive(k),
    ).length;

    this.logger.log(`\nTotal: ${apiKeys.length} (${activeCount} active)\n`);
  }

  private async revokeApiKey(
    workspace: WorkspaceEntity,
    apiKeyId: string,
  ): Promise<void> {
    const apiKey = await this.apiKeyService.findById(apiKeyId, workspace.id);

    if (!isDefined(apiKey)) {
      this.logger.error(
        `API key ${apiKeyId} not found in workspace ${workspace.id}.`,
      );

      return;
    }

    if (apiKey.revokedAt) {
      this.logger.warn(`API key ${apiKeyId} is already revoked.`);

      return;
    }

    await this.apiKeyService.revoke(apiKeyId, workspace.id);
    this.logger.log(`API key "${apiKey.name}" (${apiKeyId}) revoked.`);
  }

  private async generateApiKey(
    workspace: WorkspaceEntity,
    options: GenerateApiKeyCommandOptions,
  ): Promise<void> {
    const expiresAt = addDays(
      new Date(),
      options.expiresIn ?? NEVER_EXPIRE_DAYS,
    );

    const adminRole = await this.roleRepository.findOne({
      where: {
        workspaceId: workspace.id,
        universalIdentifier: STANDARD_ROLE.admin.universalIdentifier,
      },
    });

    if (!isDefined(adminRole)) {
      this.logger.error(`No Admin role found for workspace ${workspace.id}.`);

      return;
    }

    let apiKey: ApiKeyEntity;

    try {
      apiKey = await this.apiKeyService.create({
        name: options.name,
        expiresAt,
        workspaceId: workspace.id,
        roleId: adminRole.id,
      });
    } catch (error) {
      this.logger.error(`Failed to create API key: ${error}`);

      return;
    }

    const tokenResult = await this.apiKeyService.generateApiKeyToken(
      workspace.id,
      apiKey.id,
      expiresAt,
    );

    if (!isDefined(tokenResult)) {
      this.logger.error('Failed to generate token.');

      return;
    }

    this.logger.log(`\nAPI key created successfully.`);
    this.logger.log(`  Name:       ${options.name}`);
    this.logger.log(`  ID:         ${apiKey.id}`);
    this.logger.log(
      `  Expires:    ${options.expiresIn ? `${options.expiresIn} days (${expiresAt.toISOString()})` : 'Never'}`,
    );
    // SECURITY: write the raw bearer token directly to stdout (NOT through
    // this.logger). The logger may be wired to a structured driver (PINO) or a
    // remote sink (Sentry) where a persisted bearer token is a credential leak.
    // The token is unrecoverable after this point, so it is shown exactly once.
    // eslint-disable-next-line no-console
    console.log(
      '\nBearer token (use in the Authorization header as "Bearer <token>").' +
        "\n⚠️  Shown once — copy it now and store it securely (e.g. the gateway's" +
        '\n    CRM_API_TOKEN). It cannot be retrieved again.\n',
    );
    // eslint-disable-next-line no-console
    console.log(tokenResult.token);
    // eslint-disable-next-line no-console
    console.log('');
  }
}
