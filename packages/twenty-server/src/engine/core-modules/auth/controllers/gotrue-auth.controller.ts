import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import * as bcrypt from 'bcrypt';

import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

/**
 * /api/auth/gotrue-login  — email+password via GoTrue → redirect to /verify
 * /api/auth/admin-token   — admin token bypass → redirect to /verify
 *
 * Option 3: GoTrue proves identity, then we hand off to Twenty's native
 * /verify?loginToken=... flow. This avoids the Jotai/cookie race condition
 * that caused the blank dashboard bug.
 *
 * Flow: GoTrue auth → find/create Twenty user → LoginTokenService.generateLoginToken
 * → redirect to /verify?loginToken=... → Twenty's VerifyLoginTokenEffect handles
 * everything: sets token via Jotai, loads currentUser, hydrates workspace state.
 */
@Controller('api/auth')
export class GoTrueAuthController {
  private readonly logger = new Logger(GoTrueAuthController.name);
  private readonly gotrueUrl: string | undefined;
  private readonly adminToken: string | undefined;
  private readonly serverBaseUrl: string | undefined;

  constructor(
    private readonly loginTokenService: LoginTokenService,
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
    this.serverBaseUrl = process.env.SERVER_URL || process.env.REACT_APP_SERVER_BASE_URL;
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

  /**
   * Generate a Twenty-native login token and return redirect URL.
   * The frontend's VerifyLoginTokenEffect will handle the rest.
   */
  private async generateLoginTokenRedirect(
    email: string,
    workspaceId: string,
  ): Promise<string> {
    const loginToken = await this.loginTokenService.generateLoginToken(
      email,
      workspaceId,
      AuthProviderEnum.SSO,
    );

    const baseUrl = this.serverBaseUrl || 'https://crm.askexe.com';

    return `${baseUrl}/verify?loginToken=${encodeURIComponent(loginToken.token)}`;
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

      const tableCheck = await this.dataSource.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces'`,
      );

      if (tableCheck.length === 0) {
        this.logger.warn('Wiki tables do not exist in public schema — skipping wiki provisioning');
        return;
      }

      await this.dataSource.query(`
        INSERT INTO public.workspaces (name, slug, "createdAt", "lastUpdatedAt")
        SELECT $1, $2, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = $2)
      `, [workspaceName, slug]);

      await this.dataSource.query(`
        INSERT INTO public.users (username, password, role, gotrue_id, "createdAt", "lastUpdatedAt")
        SELECT $1, $2, 'admin', $3, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE username = $1)
      `, [email.toLowerCase().trim(), passwordHash, gotrueUserId ?? null]);

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

        // Activate workspace
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
          }
        }

        // Wiki provisioning
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

    // Activate if still pending
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

    // Step 3: Generate Twenty-native login token and redirect
    try {
      const redirectUrl = await this.generateLoginTokenRedirect(
        ctx!.user.email,
        ctx!.workspace.id,
      );

      this.logger.log(`GoTrue login success for ${email} → redirecting to /verify`);

      return res.json({ redirectUrl });
    } catch (err) {
      this.logger.error(`Login token generation failed for ${email}: ${err}`);

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

    // Activate workspace if still pending
    if (workspace.activationStatus === WorkspaceActivationStatus.PENDING_CREATION) {
      try {
        const user = await this.userRepository.findOne({
          where: { id: userWorkspace.userId },
        });

        if (user) {
          await this.workspaceService.activateWorkspace(
            user,
            workspace,
            { displayName: workspace.displayName || 'Exe' },
          );
          this.logger.log(`Workspace activated via admin-token (${workspace.id})`);
        }
      } catch (activateErr) {
        this.logger.error(`Workspace activation failed (non-fatal): ${activateErr}`);
      }
    }

    // Generate Twenty-native login token and return redirect URL
    try {
      const user = await this.userRepository.findOne({
        where: { id: userWorkspace.userId },
      });

      if (!user) {
        return res.status(500).json({ error: 'User not found' });
      }

      const redirectUrl = await this.generateLoginTokenRedirect(
        user.email,
        workspace.id,
      );

      this.logger.log(`Admin token login → redirecting to /verify`);

      return res.json({ redirectUrl, user: { id: user.id }, isAdminToken: true });
    } catch (err) {
      this.logger.error(`Admin token generation failed: ${err}`);

      return res.status(500).json({ error: 'Failed to generate session token' });
    }
  }
}
