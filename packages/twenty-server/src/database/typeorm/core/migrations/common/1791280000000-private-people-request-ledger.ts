import { type MigrationInterface, type QueryRunner } from 'typeorm';

import {
  PRIVATE_PEOPLE_LOCK_BODY,
  PRIVATE_PEOPLE_LOCK_OWNER,
  PRIVATE_PEOPLE_POLICY_SQL,
} from 'src/engine/core-modules/company-people/private-people-lock-policy';

// The helper locks existing policy surfaces; it never creates a user, grants a
// business role, changes policy or writes a contact. Runtime grants stay absent.
const owner = PRIVATE_PEOPLE_LOCK_OWNER;
const qualified = PRIVATE_PEOPLE_POLICY_SQL;

export class PrivatePeopleRequestLedger1791280000000 implements MigrationInterface {
  name = 'PrivatePeopleRequestLedger1791280000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE core."privatePeopleOperatorBinding" (
        "companyId" uuid NOT NULL, "subjectId" uuid NOT NULL,
        "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
        "bindingId" uuid NOT NULL, "generationId" uuid NOT NULL,
        "clientId" text NOT NULL, audience text NOT NULL,
        "userId" uuid NOT NULL REFERENCES core."user"(id),
        "userWorkspaceId" uuid NOT NULL REFERENCES core."userWorkspace"(id),
        "workspaceMemberId" uuid NOT NULL, "roleId" uuid NOT NULL REFERENCES core.role(id),
        PRIMARY KEY("companyId","subjectId","bindingId","generationId")
      );
      REVOKE ALL ON core."privatePeopleOperatorBinding" FROM PUBLIC;
      CREATE TABLE core."privatePeopleRequest" (
        "requestId" uuid PRIMARY KEY,
        "companyId" uuid NOT NULL, "subjectId" uuid NOT NULL,
        "workspaceId" uuid NOT NULL REFERENCES core.workspace(id),
        "bindingId" uuid NOT NULL, "generationId" uuid NOT NULL,
        "clientId" text NOT NULL, "audience" text NOT NULL,
        "authzEpoch" text NOT NULL, "policyRevision" text NOT NULL,
        "currentRole" text NOT NULL CHECK("currentRole" IN ('owner','member')),
        "nativeUserId" uuid NOT NULL, "nativeUserWorkspaceId" uuid NOT NULL,
        "nativeWorkspaceMemberId" uuid NOT NULL, "nativeRoleId" uuid NOT NULL,
        action text NOT NULL CHECK(action IN ('crm:people:create','crm:people:import')),
        "payloadSha256" text NOT NULL CHECK("payloadSha256" ~ '^[a-f0-9]{64}$'),
        "nativeRecordIds" uuid[] NOT NULL CHECK(cardinality("nativeRecordIds") BETWEEN 1 AND 1000),
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      REVOKE ALL ON core."privatePeopleRequest" FROM PUBLIC;
      CREATE FUNCTION core.refuse_private_people_ledger_mutation() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
          RAISE EXCEPTION 'Private people request is immutable';
        END; $$;
      REVOKE ALL ON FUNCTION core.refuse_private_people_ledger_mutation() FROM PUBLIC;
      CREATE TRIGGER private_people_binding_immutable BEFORE UPDATE OR DELETE
        ON core."privatePeopleOperatorBinding" FOR EACH ROW
        EXECUTE FUNCTION core.refuse_private_people_ledger_mutation();
      CREATE TRIGGER private_people_ledger_immutable BEFORE UPDATE OR DELETE
        ON core."privatePeopleRequest" FOR EACH ROW
        EXECUTE FUNCTION core.refuse_private_people_ledger_mutation();
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${owner}') THEN
          RAISE EXCEPTION 'Private people helper role collision';
        END IF;
        CREATE ROLE ${owner} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
          NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      END; $$;
      GRANT USAGE ON SCHEMA core TO ${owner};
      GRANT SELECT,UPDATE ON ${qualified} TO ${owner};
      GRANT SELECT ON core."privatePeopleOperatorBinding",core."privatePeopleRequest" TO ${owner};
      CREATE FUNCTION core.lock_private_people_policy(
        wid uuid, sid uuid, cid uuid, bid uuid, gid uuid, client text,
        aud text, rid uuid, uid uuid, uwid uuid, mid uuid) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $people$${PRIVATE_PEOPLE_LOCK_BODY}$people$;
      ALTER FUNCTION core.lock_private_people_policy(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid) OWNER TO ${owner};
      REVOKE ALL ON FUNCTION core.lock_private_people_policy(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid) FROM PUBLIC;
      -- Operator review must grant only this EXECUTE, ledger INSERT/SELECT and
      -- measured native read/contact INSERT columns to a separate business login.
      -- No login, membership, onboarding grant or PUBLIC activation is created.
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION core.lock_private_people_policy(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid);
      REVOKE SELECT,UPDATE ON ${qualified} FROM ${owner};
      REVOKE SELECT ON core."privatePeopleOperatorBinding",core."privatePeopleRequest" FROM ${owner};
      REVOKE USAGE ON SCHEMA core FROM ${owner};
      DROP ROLE ${owner};
      DROP TABLE core."privatePeopleRequest";
      DROP TABLE core."privatePeopleOperatorBinding";
      DROP FUNCTION core.refuse_private_people_ledger_mutation();
    `);
  }
}
