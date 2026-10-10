import { type MigrationInterface, type QueryRunner } from 'typeorm';

// Additive scope history; the shipped V1 migration and immutable trigger stay unchanged.
export class NativeIdentityActivationScopes1791520000000 implements MigrationInterface {
  name = 'NativeIdentityActivationScopes1791520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE core."privateNativeIdentityActivation"
        ADD COLUMN "activationVersion" smallint,
        ADD COLUMN "activationScopes" text[],
        ADD CONSTRAINT private_native_identity_activation_scopes_closed CHECK (
          ("activationVersion" IS NULL AND "activationScopes" IS NULL) OR
          ("activationVersion" IS NOT NULL AND "activationVersion"=2 AND "activationScopes" IS NOT NULL AND
           "activationScopes" IN (ARRAY['crm:read']::text[],ARRAY['crm:read','crm:write']::text[]))
        );
      DO $scope_history$
      DECLARE existing_constraint text;
      BEGIN
        SELECT c.conname INTO STRICT existing_constraint
        FROM pg_constraint c
        WHERE c.conrelid='core."privateNativeIdentityActivation"'::regclass AND c.contype='u'
          AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.position)
          =ARRAY['companyId','subjectId','workspaceId','generationId','identitySha256']::text[];
        EXECUTE format('ALTER TABLE core."privateNativeIdentityActivation" DROP CONSTRAINT %I',existing_constraint);
      END
      $scope_history$;
      CREATE UNIQUE INDEX private_native_identity_activation_legacy_identity
        ON core."privateNativeIdentityActivation"("companyId","subjectId","workspaceId","generationId","identitySha256")
        WHERE "activationScopes" IS NULL;
      -- V2 retains requestId PRIMARY KEY and immutable rows. Its exact selected
      -- request/payload/receipt/scopes and current native role are checked together.
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Never erase V2 historical receipts to make downgrade look successful.
    await queryRunner.query(`
      DO $scope_history$
      BEGIN
        IF EXISTS(SELECT 1 FROM core."privateNativeIdentityActivation" WHERE "activationVersion" IS NOT NULL) THEN
          RAISE EXCEPTION 'Native activation scope history prevents downgrade' USING ERRCODE='55000';
        END IF;
      END
      $scope_history$;
      DROP INDEX core.private_native_identity_activation_legacy_identity;
      ALTER TABLE core."privateNativeIdentityActivation"
        ADD UNIQUE("companyId","subjectId","workspaceId","generationId","identitySha256"),
        DROP CONSTRAINT private_native_identity_activation_scopes_closed,
        DROP COLUMN "activationScopes",
        DROP COLUMN "activationVersion";
    `);
  }
}
