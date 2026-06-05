import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { v4 } from 'uuid';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

/**
 * Auto-bootstraps a default workspace and admin user on first boot when
 * core.workspace is empty. This allows the CRM to be functional immediately
 * after a fresh deploy — the GoTrue login flow will then activate the
 * workspace on the admin's first login.
 *
 * Idempotent: checks row count before inserting. Safe to run on every restart.
 */
@Injectable()
export class WorkspaceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceBootstrapService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.bootstrapIfEmpty();
    } catch (err) {
      this.logger.error(
        `Workspace bootstrap failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async bootstrapIfEmpty(): Promise<void> {
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM core.workspace WHERE "deletedAt" IS NULL`,
    );

    if (count > 0) {
      this.logger.debug(
        `Found ${count} workspace(s) — skipping bootstrap.`,
      );

      return;
    }

    this.logger.log(
      'No workspaces found — bootstrapping default workspace and admin user...',
    );

    const adminEmail = (
      process.env.EXE_CRM_ADMIN_EMAIL || 'admin@askexe.com'
    )
      .toLowerCase()
      .trim();

    const workspaceId = v4();
    const userId = v4();
    const userWorkspaceId = v4();
    const applicationId = v4();
    const inviteHash = v4();
    const subdomain = 'exe';

    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Create the application record (workspace FK requires it)
      await queryRunner.query(
        `INSERT INTO core.application (id, name, "universalIdentifier")
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [applicationId, 'Exe CRM', `exe-crm-${workspaceId.slice(0, 8)}`],
      );

      // 2. Create the workspace
      await queryRunner.query(
        `INSERT INTO core.workspace (
           id, subdomain, "displayName", "inviteHash",
           "activationStatus", "workspaceCustomApplicationId",
           "isPasswordAuthEnabled", "isGoogleAuthEnabled",
           "isMicrosoftAuthEnabled", "metadataVersion"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`,
        [
          workspaceId,
          subdomain,
          'Exe',
          inviteHash,
          'PENDING_CREATION',
          applicationId,
          true,
          true,
          true,
          1,
        ],
      );

      // 3. Create the admin user
      await queryRunner.query(
        `INSERT INTO core."user" (
           id, email, "firstName", "lastName",
           "isEmailVerified", "canImpersonate", "canAccessFullAdminPanel"
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [userId, adminEmail, 'Admin', '', true, true, true],
      );

      // 4. Link user to workspace
      await queryRunner.query(
        `INSERT INTO core."userWorkspace" (
           id, "userId", "workspaceId"
         ) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userWorkspaceId, userId, workspaceId],
      );

      await queryRunner.commitTransaction();

      this.logger.log(
        `Bootstrapped workspace=${workspaceId} (PENDING_CREATION) ` +
          `with admin user=${adminEmail}. ` +
          `Workspace will be activated on first login.`,
      );
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
