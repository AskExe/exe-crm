import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { ClickHouseService } from './clickHouse.service';

// Table definitions that mirror the .sql migration files.
// If ClickHouse is enabled and tables don't exist, create them at startup.
// Uses CREATE TABLE IF NOT EXISTS so it's safe to run repeatedly.
const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS workspaceEvent (
    \`event\`      LowCardinality(String) NOT NULL,
    \`timestamp\`   DateTime64(3) NOT NULL,
    \`userId\`      String DEFAULT '',
    \`workspaceId\` String NOT NULL,
    \`properties\`  JSON
  ) ENGINE = MergeTree
    ORDER BY (workspaceId, timestamp, event, userId)
    TTL timestamp + INTERVAL 3 YEAR DELETE`,

  `CREATE TABLE IF NOT EXISTS pageview (
    \`name\`        LowCardinality(String) NOT NULL,
    \`timestamp\`   DateTime64(3) NOT NULL,
    \`userId\`      String DEFAULT '',
    \`workspaceId\` String DEFAULT '',
    \`properties\`  JSON
  ) ENGINE = MergeTree
    ORDER BY (workspaceId, timestamp, name, userId)
    TTL timestamp + INTERVAL 3 YEAR DELETE`,

  `CREATE TABLE IF NOT EXISTS objectEvent (
    \`event\`            LowCardinality(String) NOT NULL,
    \`timestamp\`        DateTime64(3) NOT NULL,
    \`userId\`           String DEFAULT '',
    \`workspaceId\`      String NOT NULL,
    \`recordId\`         String NOT NULL,
    \`objectMetadataId\` String NOT NULL,
    \`properties\`       JSON,
    \`isCustom\`         Boolean DEFAULT FALSE
  ) ENGINE = MergeTree
    ORDER BY (workspaceId, timestamp, event, userId)
    TTL timestamp + INTERVAL 3 YEAR DELETE`,

  `CREATE TABLE IF NOT EXISTS usageEvent (
    \`timestamp\`          DateTime64(3) NOT NULL,
    \`workspaceId\`        String NOT NULL,
    \`userWorkspaceId\`    String DEFAULT '',
    \`resourceType\`       LowCardinality(String) NOT NULL,
    \`operationType\`      LowCardinality(String) NOT NULL,
    \`quantity\`           Int64 NOT NULL DEFAULT 0,
    \`unit\`               LowCardinality(String) NOT NULL DEFAULT 'CREDIT',
    \`creditsUsedMicro\`   Int64 NOT NULL DEFAULT 0,
    \`resourceId\`         String DEFAULT '',
    \`resourceContext\`    String DEFAULT '',
    \`metadata\`           JSON
  ) ENGINE = MergeTree
    ORDER BY (workspaceId, timestamp, resourceType, operationType, userWorkspaceId, resourceId)
    TTL timestamp + INTERVAL 3 YEAR DELETE`,
];

@Injectable()
export class ClickHouseTableInitService implements OnModuleInit {
  private readonly logger = new Logger(ClickHouseTableInitService.name);

  constructor(private readonly clickHouseService: ClickHouseService) {}

  async onModuleInit() {
    const client = this.clickHouseService.getMainClient();

    if (!client) {
      // ClickHouse is not configured — skip silently
      return;
    }

    this.logger.log('Ensuring ClickHouse tables exist...');

    for (const ddl of TABLE_DEFINITIONS) {
      try {
        await client.command({
          query: ddl,
          clickhouse_settings: {
            allow_experimental_json_type: 1,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to ensure ClickHouse table: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log('ClickHouse table init complete.');
  }
}
