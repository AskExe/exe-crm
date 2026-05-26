import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddFieldAuditLogAndDataProvenanceTables1774800000000 implements MigrationInterface {
  name = 'AddFieldAuditLogAndDataProvenanceTables1774800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "core"."fieldAuditLog" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "objectMetadataId" uuid NOT NULL,
        "recordId" uuid NOT NULL,
        "fieldName" character varying NOT NULL,
        "oldValue" jsonb,
        "newValue" jsonb,
        "changedByUserId" uuid NOT NULL,
        "changedBySource" character varying NOT NULL,
        "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "rawEventId" uuid,
        CONSTRAINT "PK_fieldAuditLog" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_fieldAuditLog_workspace_record"
        ON "core"."fieldAuditLog" ("workspaceId", "recordId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_fieldAuditLog_workspace_object"
        ON "core"."fieldAuditLog" ("workspaceId", "objectMetadataId")
    `);

    await queryRunner.query(`
      CREATE TABLE "core"."dataProvenance" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "objectMetadataId" uuid NOT NULL,
        "recordId" uuid NOT NULL,
        "rawEventId" uuid NOT NULL,
        "rawSource" character varying NOT NULL,
        "ingestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "transformationLog" jsonb,
        CONSTRAINT "PK_dataProvenance" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dataProvenance_workspace_record"
        ON "core"."dataProvenance" ("workspaceId", "recordId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dataProvenance_workspace_rawEvent"
        ON "core"."dataProvenance" ("workspaceId", "rawEventId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_dataProvenance_workspace_rawEvent"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_dataProvenance_workspace_record"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "core"."dataProvenance"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_fieldAuditLog_workspace_object"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "core"."IDX_fieldAuditLog_workspace_record"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "core"."fieldAuditLog"`);
  }
}
