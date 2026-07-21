import { Body, Controller, Logger, Post, Req, Res } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';

import {
  ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR,
  AdminTokenAuthFailureRateLimiter,
  getAdminTokenClientIp,
} from 'src/engine/core-modules/auth/utils/admin-token-auth-failure-rate-limiter.util';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { getRequestOrigin } from 'src/utils/get-request-origin';
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
  private readonly adminTokenAuthFailureRateLimiter =
    new AdminTokenAuthFailureRateLimiter(10, 60_000);

  constructor(
    private readonly loginTokenService: LoginTokenService,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
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

  /**
   * Resolve the caller's tenant/workspace from the verified request origin
   * (subdomain / custom domain), falling back to the single default workspace
   * only in single-workspace deployments. This NEVER silently selects the
   * first/oldest workspace — in multi-tenant mode an unresolvable origin
   * returns null and the caller must fail closed.
   */
  private async resolveWorkspaceFromRequest(
    req: Request | undefined,
  ): Promise<WorkspaceEntity | null> {
    const origin = getRequestOrigin(req) ?? this.serverBaseUrl;

    if (!origin) return null;

    return (
      (await this.workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
        origin,
      )) ?? null
    );
  }

  private consumeAdminTokenAuthFailure(req: Request | undefined): boolean {
    const clientIp = req ? getAdminTokenClientIp(req) : 'unknown';
    const isRateLimited =
      this.adminTokenAuthFailureRateLimiter.consumeFailure(clientIp);

    if (isRateLimited) {
      this.logger.warn(
        `Admin token login failed-auth rate limit exceeded for IP=${clientIp}`,
      );
    }

    return isRateLimited;
  }

  private async findUser(email: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });
  }

  /**
   * Context for an existing user, bound to the workspace derived from the
   * request. `userWorkspace` is null when the user is NOT a member of the
   * resolved tenant — callers MUST reject in that case rather than issue a
   * token, so a valid identity is never routed into the wrong tenant.
   */
  private async getUserContext(email: string, req: Request | undefined) {
    const user = await this.findUser(email);

    if (!user) return null;

    const workspace = await this.resolveWorkspaceFromRequest(req);

    if (!workspace) return null;

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId: user.id, workspaceId: workspace.id },
    });

    return { user, workspace, userWorkspace };
  }

  /**
   * Context for a freshly provisioned user, bound to the workspace the user
   * was actually added to (their own membership) — not a global lookup. A
   * just-provisioned user has exactly one membership, so this is unambiguous
   * and cannot leak into another tenant.
   */
  private async getContextByMembership(email: string) {
    const user = await this.findUser(email);

    if (!user) return null;

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (!userWorkspace) return null;

    const workspace = await this.workspaceRepository.findOne({
      where: { id: userWorkspace.workspaceId },
    });

    if (!workspace) return null;

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
    @Req() req?: Request,
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

    // Step 2: Resolve identity and tenant.
    // A brand-new user (no Twenty account yet) goes through first-login
    // provisioning. An existing user is bound to the workspace derived from the
    // request origin and MUST be a member of it — we never select a global
    // first/oldest workspace.
    const existingUser = await this.findUser(email);
    const isFirstLogin = !existingUser;

    let ctx: {
      user: UserEntity;
      workspace: WorkspaceEntity;
      userWorkspace: UserWorkspaceEntity | null;
    } | null = null;

    // First login — need workspace name. If not provided, signal frontend to ask.
    if (isFirstLogin && !workspaceName) {
      return res.status(200).json({
        needsSetup: true,
        message: 'First login — please provide a workspace name.',
      });
    }

    // First login — provision everything, then bind to the user's OWN new
    // workspace membership (not a global lookup).
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

        ctx = await this.getContextByMembership(email);

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

            const activatedCtx = await this.getContextByMembership(email);

            if (!activatedCtx) {
              throw new Error('User context missing after activation');
            }

            ctx = activatedCtx;
          } catch (activateErr) {
            this.logger.error(
              `Workspace activation failed (non-fatal): ${activateErr}`,
            );
          }
        }

        // Wiki provisioning is intentionally NOT done here — the Wiki owns and
        // provisions its own user/workspace on first Wiki login via GoTrue.

        this.logger.log(
          `Provisioned: CRM workspace=${ctx.workspace.id} (${ctx.workspace.activationStatus})`,
        );
      } catch (provisionErr) {
        this.logger.error(`Provisioning failed for ${email}: ${provisionErr}`);

        return res.status(500).json({
          error: 'Failed to set up your workspace. Please try again.',
        });
      }
    } else {
      // Existing user — bind to the tenant derived from the request origin and
      // enforce membership. If the user is not a member of the resolved
      // workspace we MUST NOT issue a token (cross-tenant routing guard).
      ctx = await this.getUserContext(email, req);

      if (!ctx) {
        this.logger.warn(
          `GoTrue login for ${email} — could not resolve a tenant for this request`,
        );

        return res
          .status(400)
          .json({ error: 'Unable to determine workspace for this request' });
      }

      if (!ctx.userWorkspace) {
        this.logger.warn(
          `GoTrue login denied for ${email} — not a member of workspace ${ctx.workspace.id}`,
        );

        return res
          .status(403)
          .json({ error: 'You do not have access to this workspace' });
      }
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

        const refreshedCtx = await this.workspaceRepository.findOne({
          where: { id: ctx.workspace.id },
        });

        if (refreshedCtx) {
          ctx = { ...ctx, workspace: refreshedCtx };
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
    @Req() req?: Request,
  ) {
    const { token } = body ?? {};

    if (!token) {
      if (this.consumeAdminTokenAuthFailure(req)) {
        return res.status(429).json({
          error: ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR,
        });
      }

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
      if (this.consumeAdminTokenAuthFailure(req)) {
        return res.status(429).json({
          error: ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR,
        });
      }

      this.logger.warn('Admin token login rejected');

      return res.status(401).json({ error: 'Authentication failed' });
    }

    // Bind the admin bypass to the tenant derived from the request origin
    // (subdomain / custom domain), or the single default workspace in
    // single-workspace deployments. Never select a global first/oldest
    // workspace — that would route the admin into an arbitrary tenant.
    const workspace = await this.resolveWorkspaceFromRequest(req);

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
