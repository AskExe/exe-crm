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
 *
 * FAILURE POSTURE. A CRM whose bootstrap did not run has no workspace and no
 * user: nobody can sign in, so the service cannot serve its purpose. That state
 * must never be reported as healthy. The boot failure is therefore recorded
 * here and surfaced by GET /healthz (HealthController), which is the probe the
 * shipped stack's healthcheck uses — so `docker ps` shows the container
 * unhealthy and the operator sees a reason instead of discovering it at the
 * first refused sign-in.
 *
 * The process is deliberately NOT killed: this is a 20-service stack where a
 * crash-looping container has no readable /healthz, and a transient database
 * error at boot would otherwise turn a recoverable install into a crash loop.
 * Instead the failure is retried on every readiness probe, so the install heals
 * as soon as the cause is gone — whether that is the operator setting the
 * missing variable and recreating the container, a workspace appearing by some
 * other route, or the database simply coming back.
 */
@Injectable()
export class WorkspaceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceBootstrapService.name);

  /**
   * `null` while this install is serviceable (bootstrap ran, or was correctly
   * skipped because a workspace already exists). A reason string while it is
   * not. Read by the readiness probe below.
   */
  private bootstrapFailureReason: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.bootstrapIfEmpty();
      this.bootstrapFailureReason = null;
    } catch (err) {
      this.bootstrapFailureReason =
        err instanceof Error ? err.message : String(err);

      this.logger.error(
        `UNUSABLE INSTALL — workspace bootstrap failed: ${this.bootstrapFailureReason} ` +
          'This CRM has no workspace and no admin user, so no one can sign in. ' +
          'GET /healthz reports NOT ready until this is resolved.',
      );
    }
  }

  /**
   * Readiness contract consumed by GET /healthz.
   *
   * Fast path (every healthy install, including every already-bootstrapped one)
   * is a single field read — no database work is added to the probe. Only an
   * install that is already broken pays for a retry, and that retry is the same
   * idempotent, transactional bootstrap: it inserts nothing once a workspace
   * exists.
   */
  async checkReadiness(): Promise<{ ready: boolean; reason?: string }> {
    if (this.bootstrapFailureReason === null) {
      return { ready: true };
    }

    try {
      await this.bootstrapIfEmpty();
      this.bootstrapFailureReason = null;

      this.logger.log('Workspace bootstrap recovered — reporting ready again.');

      return { ready: true };
    } catch (err) {
      this.bootstrapFailureReason =
        err instanceof Error ? err.message : String(err);

      return { ready: false, reason: this.bootstrapFailureReason };
    }
  }

  private async bootstrapIfEmpty(): Promise<void> {
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM core.workspace WHERE "deletedAt" IS NULL`,
    );

    if (count > 0) {
      this.logger.debug(`Found ${count} workspace(s) — skipping bootstrap.`);

      return;
    }

    this.logger.log(
      'No workspaces found — bootstrapping default workspace and admin user...',
    );

    // Trim BEFORE the emptiness check: a whitespace-only value passed the old
    // check and then trimmed to '', seeding an admin user with no email — a
    // second flavour of unusable install.
    const adminEmail = (process.env.EXE_CRM_ADMIN_EMAIL ?? '')
      .trim()
      .toLowerCase();

    if (adminEmail === '') {
      throw new Error(
        'EXE_CRM_ADMIN_EMAIL must be set to bootstrap the workspace admin user. ' +
          'Set it in your environment before starting the server.',
      );
    }

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
      // universalIdentifier is a uuid column — must be a valid UUID, not a slug
      await queryRunner.query(
        `INSERT INTO core.application (id, name, "universalIdentifier")
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [applicationId, 'Exe CRM', applicationId],
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
