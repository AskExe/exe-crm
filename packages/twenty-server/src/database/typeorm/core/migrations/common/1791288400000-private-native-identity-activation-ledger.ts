import { type MigrationInterface, type QueryRunner } from 'typeorm';

// Source-only, default revoked. No role/login/grant/onboarding is created.
export class PrivateNativeIdentityActivationLedger1791288400000 implements MigrationInterface {
  name = 'PrivateNativeIdentityActivationLedger1791288400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE core."privateNativeIdentityActivation" (
        "requestId" uuid PRIMARY KEY,
        "companyId" uuid NOT NULL, "subjectId" uuid NOT NULL,
        "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
        "clientId" text NOT NULL CHECK(length("clientId") BETWEEN 1 AND 256),
        "bindingId" uuid NOT NULL, "generationId" uuid NOT NULL,
        "authzEpoch" text NOT NULL CHECK("authzEpoch" ~ '^[0-9]{1,20}$'),
        audience text NOT NULL CHECK(length(audience) BETWEEN 1 AND 256),
        action text NOT NULL CHECK(action='crm:native-identity:activate'),
        "policyRevision" text NOT NULL CHECK(length("policyRevision") BETWEEN 1 AND 128),
        "payloadSha256" text NOT NULL CHECK("payloadSha256" ~ '^[a-f0-9]{64}$'),
        "identitySha256" text NOT NULL CHECK("identitySha256" ~ '^[a-f0-9]{64}$'),
        "parentSessionId" uuid NOT NULL,
        "parentExp" text NOT NULL CHECK("parentExp" ~ '^[1-9][0-9]{0,19}$'),
        attempt integer NOT NULL CHECK(attempt=1),
        "coordinatorId" text NOT NULL CHECK("coordinatorId" ~ '^[a-z][a-z0-9_-]{2,63}$'),
        "profileSha256" text NOT NULL CHECK("profileSha256" ~ '^[a-f0-9]{64}$'),
        "databaseAssociationSha256" text NOT NULL CHECK("databaseAssociationSha256" ~ '^[a-f0-9]{64}$'),
        "userId" uuid NOT NULL REFERENCES core."user"(id),
        "userWorkspaceId" uuid NOT NULL REFERENCES core."userWorkspace"(id),
        "workspaceMemberId" uuid NOT NULL,
        "roleId" uuid NOT NULL REFERENCES core.role(id),
        "expiresAt" timestamptz NOT NULL,
        "cleanupExpiresAt" timestamptz NOT NULL CHECK("cleanupExpiresAt"="expiresAt"+interval '60 seconds'),
        "ackUtf8" bytea NOT NULL CHECK(octet_length("ackUtf8") BETWEEN 1 AND 4096),
        "ackSha256" text NOT NULL CHECK("ackSha256" ~ '^[a-f0-9]{64}$'),
        "receiptInputUtf8" bytea NOT NULL CHECK(octet_length("receiptInputUtf8") BETWEEN 1 AND 8192),
        "receiptSha256" text NOT NULL CHECK("receiptSha256" ~ '^[a-f0-9]{64}$'),
        UNIQUE("companyId","subjectId","workspaceId","generationId","identitySha256")
      );
      REVOKE ALL ON core."privateNativeIdentityActivation" FROM PUBLIC;
      CREATE FUNCTION core.refuse_private_native_identity_activation_mutation() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
          RAISE EXCEPTION 'Private native identity activation is immutable';
        END; $$;
      REVOKE ALL ON FUNCTION core.refuse_private_native_identity_activation_mutation() FROM PUBLIC;
      CREATE TRIGGER private_native_identity_activation_immutable BEFORE UPDATE OR DELETE
        ON core."privateNativeIdentityActivation" FOR EACH ROW
        EXECUTE FUNCTION core.refuse_private_native_identity_activation_mutation();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE core."privateNativeIdentityActivation";
      DROP FUNCTION core.refuse_private_native_identity_activation_mutation();
    `);
  }
}
