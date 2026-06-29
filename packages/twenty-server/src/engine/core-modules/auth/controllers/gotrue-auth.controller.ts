import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';

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
  private readonly adminTokenHash: Buffer | undefined;
  private readonly serverBaseUrl: string | undefined;

  constructor(
    private readonly loginTokenService: LoginTokenService,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    const rawToken = process.env.EXE_CRM_ADMIN_TOKEN;

    this.adminTokenHash = rawToken
      ? createHash('sha256').update(rawToken).digest()
      : undefined;
    this.serverBaseUrl =
      process.env.SERVER_URL || process.env.REACT_APP_SERVER_BASE_URL;
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

    if (!this.serverBaseUrl) {
      throw new Error(
        'SERVER_URL (or REACT_APP_SERVER_BASE_URL) must be set. ' +
          'Cannot generate login redirect without a configured base URL.',
      );
    }

    const baseUrl = this.serverBaseUrl;

    return `${baseUrl}/verify?loginToken=${encodeURIComponent(loginToken.token)}`;
  }

  // NOTE: CRM does NOT provision Wiki accounts. The Wiki owns its own data
  // (public.workspaces / public.users / public.workspace_users) and provisions
  // its user lazily on first Wiki login via the shared GoTrue identity
  // (exe-wiki POST /api/request-token → resolveGoTrueUser). CRM writing those
  // tables directly violated the Wiki data-ownership boundary, duplicated the
  // Wiki's role-assignment / workspace-linking / audit-logging logic, and risked
  // schema drift. Cross-service provisioning must go through the owning service.

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

        this.logger.warn(
          `GoTrue auth failed for ${email}: status=${gotrueRes.status} ` +
            `error=${errBody?.error_description || errBody?.msg || 'unknown'}`,
        );

        return res.status(401).json({
          error: 'Authentication failed',
        });
      }

      // Identity is proven by gotrueRes.ok; drain the body so the socket is
      // released. CRM no longer needs any GoTrue claims here.
      await gotrueRes.json().catch(() => undefined);
    } catch (err) {
      this.logger.error(`GoTrue request failed: ${err}`);

      return res
        .status(502)
        .json({ error: 'Authentication service unavailable' });
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

      this.logger.log(
        `First login for ${email} — provisioning workspace "${wsName}"`,
      );

      try {
        await this.signInUpService.signUpOnNewWorkspace({
          type: 'newUserWithPicture',
          newUserWithPicture: {
            email,
            firstName: email.split('@')[0] ?? 'User',
            lastName: '',
            picture: undefined,
          },
        });

        ctx = await this.getUserContext(email);

        if (!ctx) {
          throw new Error('User context missing after provisioning');
        }

        // Activate workspace
        if (
          ctx.workspace.activationStatus ===
          WorkspaceActivationStatus.PENDING_CREATION
        ) {
          try {
            await this.workspaceService.activateWorkspace(
              ctx.user as any,
              ctx.workspace,
              { displayName: wsName },
            );
            ctx = await this.getUserContext(email);

            if (!ctx) {
              throw new Error('User context missing after activation');
            }
          } catch (activateErr) {
            this.logger.error(
              `Workspace activation failed (non-fatal): ${activateErr}`,
            );
          }
        }

        // Wiki provisioning is intentionally NOT done here — the Wiki owns and
        // provisions its own user/workspace on first Wiki login via GoTrue.

        // ctx is non-null here: if getUserContext returned null after
        // provisioning or activation, we threw above (lines 241-242 or
        // 255-256), which would be caught by the outer catch (line 269)
        // causing an early return. TypeScript cannot track this across
        // nested try/catch reassignments, so we use a local narrowed ref.
        const provisionedCtx = ctx!;

        this.logger.log(
          `Provisioned: CRM workspace=${provisionedCtx.workspace.id} (${provisionedCtx.workspace.activationStatus})`,
        );
      } catch (provisionErr) {
        this.logger.error(`Provisioning failed for ${email}: ${provisionErr}`);

        return res.status(500).json({
          error: 'Failed to set up your workspace. Please try again.',
        });
      }
    }

    // Null guard: ctx must be defined at this point. If not, something went
    // wrong during provisioning that wasn't caught above.
    if (!ctx) {
      this.logger.error(
        `User context unexpectedly null after provisioning for ${email}`,
      );

      return res
        .status(500)
        .json({ error: 'Failed to set up your workspace. Please try again.' });
    }

    // Activate if still pending
    if (
      ctx.workspace.activationStatus ===
      WorkspaceActivationStatus.PENDING_CREATION
    ) {
      try {
        await this.workspaceService.activateWorkspace(
          ctx.user as any,
          ctx.workspace,
          { displayName: ctx.workspace.displayName || workspaceName || 'Exe' },
        );

        const refreshedCtx = await this.getUserContext(email);

        if (refreshedCtx) {
          ctx = refreshedCtx;
        }
      } catch (activateErr) {
        this.logger.error(
          `Workspace activation failed (non-fatal): ${activateErr}`,
        );
      }
    }

    // Step 3: Generate Twenty-native login token and redirect
    try {
      const redirectUrl = await this.generateLoginTokenRedirect(
        ctx.user.email,
        ctx.workspace.id,
      );

      this.logger.log(
        `GoTrue login success for ${email} → redirecting to /verify`,
      );

      return res.json({ redirectUrl });
    } catch (err) {
      this.logger.error(`Login token generation failed for ${email}: ${err}`);

      return res
        .status(500)
        .json({ error: 'Failed to generate session token' });
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

    if (!this.adminTokenHash) {
      return res.status(500).json({ error: 'Admin token not configured' });
    }

    const incomingHash = createHash('sha256').update(token).digest();

    if (
      incomingHash.length !== this.adminTokenHash.length ||
      !timingSafeEqual(incomingHash, this.adminTokenHash)
    ) {
      this.logger.warn('Admin token login rejected');

      return res.status(401).json({ error: 'Authentication failed' });
    }

    const workspace = await this.getWorkspace();

    if (!workspace) {
      return res.status(500).json({
        error: 'No workspace found. Log in with email first to create one.',
      });
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { workspaceId: workspace.id },
      order: { createdAt: 'ASC' },
    });

    if (!userWorkspace) {
      return res.status(500).json({ error: 'No user found in workspace' });
    }

    // Activate workspace if still pending
    if (
      workspace.activationStatus === WorkspaceActivationStatus.PENDING_CREATION
    ) {
      try {
        const user = await this.userRepository.findOne({
          where: { id: userWorkspace.userId },
        });

        if (user) {
          await this.workspaceService.activateWorkspace(
            user as any,
            workspace,
            { displayName: workspace.displayName || 'Exe' },
          );
          this.logger.log(
            `Workspace activated via admin-token (${workspace.id})`,
          );
        }
      } catch (activateErr) {
        this.logger.error(
          `Workspace activation failed (non-fatal): ${activateErr}`,
        );
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

      return res.json({
        redirectUrl,
        user: { id: user.id },
        isAdminToken: true,
      });
    } catch (err) {
      this.logger.error(`Admin token generation failed: ${err}`);

      return res
        .status(500)
        .json({ error: 'Failed to generate session token' });
    }
  }
}
