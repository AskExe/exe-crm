import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import * as bcrypt from 'bcrypt';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

/**
 * /api/auth/gotrue-login  — email+password via GoTrue → CRM token pair
 * /api/auth/admin-token   — admin token bypass → CRM token pair
 *
 * First login auto-provisions workspace + user in BOTH CRM and Wiki.
 * GoTrue owns identity. CRM mints session tokens. Wiki gets a matching
 * workspace + user via direct SQL (same exe-db Postgres).
 */
@Controller('api/auth')
export class GoTrueAuthController {
  private readonly logger = new Logger(GoTrueAuthController.name);
  private readonly gotrueUrl: string | undefined;
  private readonly adminToken: string | undefined;

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    this.adminToken = process.env.EXE_CRM_ADMIN_TOKEN;
  }

  private async getWorkspace(): Promise<WorkspaceEntity | null> {
    return this.workspaceRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
  }

  private async getUserContext(email: string) {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) return null;

    const workspace = await this.getWorkspace();

    if (!workspace) return null;

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId: user.id, workspaceId: workspace.id },
    });

    return { user, workspace, userWorkspace };
  }

  private async generateTokenPair(userId: string, workspaceId: string) {
    const accessToken = await this.accessTokenService.generateAccessToken({
      userId,
      workspaceId,
      authProvider: AuthProviderEnum.SSO,
    });

    const refreshToken = await this.refreshTokenService.generateRefreshToken(
      userId,
      workspaceId,
    );

    return {
      accessToken: { token: accessToken.token, expiresAt: accessToken.expiresAt },
      refreshToken: { token: refreshToken.token, expiresAt: refreshToken.expiresAt },
    };
  }

  /**
   * Provision matching workspace + user in Wiki's tables (same Postgres).
   * Idempotent — skips if already exists.
   */
  private async provisionWiki(
    email: string,
    workspaceName: string,
    gotrueUserId: string | undefined,
    password: string,
  ) {
    try {
      const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'exe';
      const passwordHash = await bcrypt.hash(password, 10);

      // Check if wiki schema exists
      // Check if wiki tables exist in public schema
      const tableCheck = await this.dataSource.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces'`,
      );

      if (tableCheck.length === 0) {
        this.logger.warn('Wiki tables do not exist in public schema — skipping wiki provisioning');
        return;
      }

      // Create wiki workspace (idempotent)
      await this.dataSource.query(`
        INSERT INTO public.workspaces (name, slug, "createdAt", "lastUpdatedAt")
        SELECT $1, $2, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = $2)
      `, [workspaceName, slug]);

      // Create wiki user (idempotent by username)
      await this.dataSource.query(`
        INSERT INTO public.users (username, password, role, gotrue_id, "createdAt", "lastUpdatedAt")
        SELECT $1, $2, 'admin', $3, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE username = $1)
      `, [email.toLowerCase().trim(), passwordHash, gotrueUserId ?? null]);

      // Link user to workspace (idempotent)
      await this.dataSource.query(`
        INSERT INTO public.workspace_users (user_id, workspace_id, "createdAt", "lastUpdatedAt")
        SELECT u.id, w.id, NOW(), NOW()
        FROM public.users u, public.workspaces w
        WHERE u.username = $1 AND w.slug = $2
        AND NOT EXISTS (
          SELECT 1 FROM public.workspace_users wu
          WHERE wu.user_id = u.id AND wu.workspace_id = w.id
        )
      `, [email.toLowerCase().trim(), slug]);

      this.logger.log(`Wiki provisioned: workspace=${slug} user=${email}`);
    } catch (err) {
      // Non-fatal — CRM login works even if wiki provisioning fails
      this.logger.error(`Wiki provisioning failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Post('gotrue-login')
  async gotrueLogin(
    @Body() body: { email?: string; password?: string; workspaceName?: string },
    @Res() res: Response,
  ) {
    const { email, password, workspaceName } = body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!this.gotrueUrl) {
      return res.status(500).json({ error: 'GoTrue is not configured' });
    }

    // Step 1: Authenticate with GoTrue
    let gotrueData: { access_token?: string; user?: { id?: string; email?: string } };

    try {
      const gotrueRes = await fetch(
        `${this.gotrueUrl}/token?grant_type=password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!gotrueRes.ok) {
        const errBody = await gotrueRes.json().catch(() => ({}));

        return res.status(401).json({
          error: errBody?.error_description || errBody?.msg || 'Invalid email or password',
        });
      }

      gotrueData = await gotrueRes.json();
    } catch (err) {
      this.logger.error(`GoTrue request failed: ${err}`);

      return res.status(502).json({ error: 'Authentication service unavailable' });
    }

    // Step 2: Check if workspace exists
    let ctx = await this.getUserContext(email);
    const isFirstLogin = !ctx;

    // First login — need workspace name. If not provided, signal frontend to ask.
    if (isFirstLogin && !workspaceName) {
      return res.status(200).json({
        needsSetup: true,
        message: 'First login — please provide a workspace name.',
      });
    }

    // First login — provision everything
    if (isFirstLogin) {
      const wsName = workspaceName!.trim() || 'Exe';

      this.logger.log(`First login for ${email} — provisioning workspace "${wsName}"`);

      try {
        // CRM: create workspace + user
        await this.signInUpService.signUpOnNewWorkspace({
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email,
            firstName: email.split('@')[0] ?? 'User',
            lastName: '',
            picture: null,
          },
        });

        ctx = await this.getUserContext(email);

        if (!ctx) {
          throw new Error('User context missing after provisioning');
        }

        // CRM: activate workspace (non-fatal — login still works if this crashes)
        if (ctx.workspace.activationStatus === WorkspaceActivationStatus.PENDING_CREATION) {
          try {
            await this.workspaceService.activateWorkspace(
              ctx.user,
              ctx.workspace,
              { displayName: wsName },
            );
            ctx = await this.getUserContext(email);

            if (!ctx) {
              throw new Error('User context missing after activation');
            }
          } catch (activateErr) {
            this.logger.error(`Workspace activation failed (non-fatal): ${activateErr}`);
            // Continue — user can still log in with PENDING workspace
          }
        }

        // Wiki: create matching workspace + user
        await this.provisionWiki(email, wsName, gotrueData.user?.id, password);

        this.logger.log(
          `Provisioned: CRM workspace=${ctx.workspace.id} (${ctx.workspace.activationStatus}) + Wiki`,
        );
      } catch (provisionErr) {
        this.logger.error(`Provisioning failed for ${email}: ${provisionErr}`);

        return res.status(500).json({
          error: 'Failed to set up your workspace. Please try again.',
        });
      }
    }

    // Activate if still pending (non-fatal — login works regardless)
    if (ctx!.workspace.activationStatus === WorkspaceActivationStatus.PENDING_CREATION) {
      try {
        await this.workspaceService.activateWorkspace(
          ctx!.user,
          ctx!.workspace,
          { displayName: ctx!.workspace.displayName || workspaceName || 'Exe' },
        );
        ctx = await this.getUserContext(email);
      } catch (activateErr) {
        this.logger.error(`Workspace activation failed (non-fatal): ${activateErr}`);
      }
    }

    // Step 3: Generate token pair
    try {
      const tokens = await this.generateTokenPair(ctx!.user.id, ctx!.workspace.id);

      return res.json({
        tokens,
        user: { id: ctx!.user.id, email: ctx!.user.email },
      });
    } catch (err) {
      this.logger.error(`Token generation failed for ${email}: ${err}`);

      return res.status(500).json({ error: 'Failed to generate session token' });
    }
  }

  @Post('admin-token')
  async adminTokenLogin(
    @Body() body: { token?: string },
    @Res() res: Response,
  ) {
    const { token } = body ?? {};

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    if (!this.adminToken) {
      return res.status(500).json({ error: 'Admin token not configured' });
    }

    if (token !== this.adminToken) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }

    const workspace = await this.getWorkspace();

    if (!workspace) {
      return res.status(500).json({ error: 'No workspace found. Log in with email first to create one.' });
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });

    if (!userWorkspace) {
      return res.status(500).json({ error: 'No user found in workspace' });
    }

    try {
      const tokens = await this.generateTokenPair(
        userWorkspace.userId,
        workspace.id,
      );

      return res.json({
        tokens,
        user: { id: userWorkspace.userId },
        isAdminToken: true,
      });
    } catch (err) {
      this.logger.error(`Admin token generation failed: ${err}`);

      return res.status(500).json({ error: 'Failed to generate session token' });
    }
  }
}
