import { type MigrationInterface, type QueryRunner } from 'typeorm';

import {
  PRIVATE_NATIVE_LOCK_BODY,
  PRIVATE_NATIVE_LOCK_OWNER,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-lock-policy';

export class AddPrivateNativeActionBinding1791145000000 implements MigrationInterface {
  name = 'AddPrivateNativeActionBinding1791145000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE core."privateNativeAction" (
        "actionId" uuid PRIMARY KEY,
        "intentId" uuid NOT NULL UNIQUE,
        "jobId" uuid NOT NULL,
        "companyId" uuid NOT NULL UNIQUE,
        "deploymentId" uuid NOT NULL UNIQUE,
        "requestKey" uuid NOT NULL UNIQUE,
        "ownerSubject" uuid NOT NULL,
        "attempt" integer NOT NULL CHECK ("attempt" > 0),
        "workerId" text NOT NULL,
        "profileSha256" text NOT NULL CHECK ("profileSha256" ~ '^[0-9a-f]{64}$'),
        "configSha256" text NOT NULL CHECK ("configSha256" ~ '^[0-9a-f]{64}$'),
        "initializerSha256" text NOT NULL CHECK ("initializerSha256" ~ '^[0-9a-f]{64}$'),
        "packageSha256" text NOT NULL CHECK ("packageSha256" ~ '^[0-9a-f]{64}$'),
        "plannedWorkspaceId" uuid NOT NULL UNIQUE,
        "plannedUserId" uuid NOT NULL UNIQUE,
        "plannedUserWorkspaceId" uuid NOT NULL UNIQUE,
        "plannedApplicationId" uuid NOT NULL UNIQUE,
        "startedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE ("actionId","plannedWorkspaceId","plannedUserId","plannedUserWorkspaceId")
      );
      CREATE TABLE core."privateNativeWorkspaceBinding" (
        "actionId" uuid PRIMARY KEY,
        "workspaceId" uuid NOT NULL UNIQUE REFERENCES core.workspace(id),
        "userId" uuid NOT NULL UNIQUE REFERENCES core."user"(id),
        "userWorkspaceId" uuid NOT NULL UNIQUE REFERENCES core."userWorkspace"(id),
        "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
        FOREIGN KEY ("actionId","workspaceId","userId","userWorkspaceId")
          REFERENCES core."privateNativeAction"
            ("actionId","plannedWorkspaceId","plannedUserId","plannedUserWorkspaceId")
      );
      CREATE FUNCTION core."refusePrivateNativeBindingMutation"() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
          RAISE EXCEPTION 'Private native binding is immutable';
        END $$;
      CREATE TRIGGER "privateNativeActionImmutable" BEFORE UPDATE OR DELETE
        ON core."privateNativeAction" FOR EACH ROW
        EXECUTE FUNCTION core."refusePrivateNativeBindingMutation"();
      CREATE TRIGGER "privateNativeWorkspaceBindingImmutable" BEFORE UPDATE OR DELETE
        ON core."privateNativeWorkspaceBinding" FOR EACH ROW
        EXECUTE FUNCTION core."refusePrivateNativeBindingMutation"();
      REVOKE ALL ON core."privateNativeAction",core."privateNativeWorkspaceBinding"
        FROM PUBLIC;
      REVOKE ALL ON FUNCTION core."refusePrivateNativeBindingMutation"() FROM PUBLIC;
      DO $role$ BEGIN
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${PRIVATE_NATIVE_LOCK_OWNER}') THEN
          RAISE EXCEPTION 'Private native role collision';
        END IF;
        CREATE ROLE ${PRIVATE_NATIVE_LOCK_OWNER} NOLOGIN NOINHERIT NOSUPERUSER
          NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END $role$;
      GRANT USAGE ON SCHEMA core TO ${PRIVATE_NATIVE_LOCK_OWNER};
      GRANT SELECT ON core.workspace,core."user",core."privateNativeAction" TO ${PRIVATE_NATIVE_LOCK_OWNER};
      -- PostgreSQL LOCK requires table UPDATE. Only the non-login helper owner,
      -- never the native writer login, receives it. The fixed body does no DML.
      GRANT UPDATE ON core.workspace,core."user" TO ${PRIVATE_NATIVE_LOCK_OWNER};
      CREATE FUNCTION core.lock_private_native_empty(aid uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
        AS $native$${PRIVATE_NATIVE_LOCK_BODY}$native$;
      ALTER FUNCTION core.lock_private_native_empty(uuid) OWNER TO ${PRIVATE_NATIVE_LOCK_OWNER};
      REVOKE ALL ON FUNCTION core.lock_private_native_empty(uuid) FROM PUBLIC;
      -- No runtime role is invented or granted here. The independently reviewed
      -- private DB bootstrap must grant exactly this EXECUTE to its writer.
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION core.lock_private_native_empty(uuid);
      REVOKE UPDATE,SELECT ON core.workspace,core."user" FROM ${PRIVATE_NATIVE_LOCK_OWNER};
      REVOKE SELECT ON core."privateNativeAction" FROM ${PRIVATE_NATIVE_LOCK_OWNER};
      REVOKE USAGE ON SCHEMA core FROM ${PRIVATE_NATIVE_LOCK_OWNER};
      DROP ROLE ${PRIVATE_NATIVE_LOCK_OWNER};
      DROP TABLE core."privateNativeWorkspaceBinding";
      DROP TABLE core."privateNativeAction";
      DROP FUNCTION core."refusePrivateNativeBindingMutation"();
    `);
  }
}
