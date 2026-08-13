import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { RoleSyncService } from 'src/engine/core-modules/auth/services/role-sync.service';
import {
  type CrmRoleTier,
  decodeJwtAppMetadata,
  isManagedPermsRequired,
  resolveExePermsForOrg,
} from 'src/engine/core-modules/auth/services/exe-perms.util';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { isAdminTokenLoginEnabled } from 'src/engine/core-modules/auth/utils/is-admin-token-login-enabled.util';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { getRequestOrigin } from 'src/utils/get-request-origin';
import { AppPath } from 'twenty-shared/types';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

type GoTrueLoginContext = {
  user: UserEntity;
  workspace: WorkspaceEntity;
  userWorkspace: UserWorkspaceEntity | null;
};

type ResolveGoTrueLoginContextResult =
  | { type: 'success'; ctx: GoTrueLoginContext }
  | { type: 'needsSetup' }
  | { type: 'error'; statusCode: number; error: string };

/**
 * Outcome of the MANAGED-login enforcement core. Kept response-agnostic so it
 * can drive either a JSON body (POST /gotrue-login) or an HTTP redirect
 * (GET /gotrue-callback) without duplicating enforcement.
 */
type ManagedLoginOutcome =
  | { type: 'redirect'; url: string }
  | { type: 'deny'; statusCode: number; error: string };

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
  /**
   * This deployment's canonical Exe org id (unified-permissions §2). When
   * unset, CRM RBAC enforcement is OFF and native behavior is preserved for
   * every login (backward compatible).
   */
  private readonly exeOrgId: string | undefined;
  /**
   * Canonical Twenty workspace bound to this deployment's Exe org
   * (unified-permissions §2, org ↔ workspace 1:1). REQUIRED whenever
   * `EXE_ORG_ID` is set: a MANAGED login resolves THIS workspace and applies
   * caps there — it never creates or owns an arbitrary new workspace. If it is
   * unset while enforcement is on, managed logins fail closed.
   */
  private readonly exeOrgWorkspaceId: string | undefined;

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly loginTokenService: LoginTokenService,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly roleSyncService: RoleSyncService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    this.exeOrgId = process.env.EXE_ORG_ID;
    this.exeOrgWorkspaceId = process.env.EXE_ORG_WORKSPACE_ID;
    const rawToken = process.env.EXE_CRM_ADMIN_TOKEN;

    this.adminTokenHash = rawToken
      ? createHash('sha256').update(rawToken).digest()
      : undefined;
    this.serverBaseUrl =
      process.env.SERVER_URL || process.env.REACT_APP_SERVER_BASE_URL;

    this.logManagedPermsMode();
  }

  /**
   * Announce the managed-permissions mode once, when the controller is
   * instantiated at boot. Disabling the gate re-enables an unmanaged first
   * login creating its own workspace and taking its Admin role, so it is a
   * security-relevant downgrade and must be visible in the logs of anyone who
   * enables it — not buried in an env file (A6.4).
   */
  private logManagedPermsMode(): void {
    if (isManagedPermsRequired()) {
      this.logger.log(
        'Managed permissions REQUIRED (default): an unmanaged first login ' +
          'creates no workspace and is granted no Admin role.',
      );

      return;
    }

    this.logger.warn(
      'SECURITY DOWNGRADE: CRM_REQUIRE_MANAGED_PERMS is disabled ' +
        `(value=${JSON.stringify(process.env.CRM_REQUIRE_MANAGED_PERMS)}). ` +
        'An unmanaged first login will CREATE A NEW WORKSPACE and be granted ' +
        'its Admin role. This is intended only for self-hosted installs with ' +
        'no control plane. Unset the variable to restore the secure default.',
    );
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

  private generateSignInRedirect(): string {
    if (!this.serverBaseUrl) {
      return AppPath.SignInUp;
    }

    return `${this.serverBaseUrl.replace(/\/$/, '')}${AppPath.SignInUp}`;
  }

  private getRequestCookie(req: Request | undefined, key: string) {
    const cookieHeader = req?.headers.cookie;
    const cookies = Array.isArray(cookieHeader)
      ? cookieHeader.join(';')
      : cookieHeader;

    if (!cookies) {
      return undefined;
    }

    for (const cookie of cookies.split(';')) {
      const trimmedCookie = cookie.trim();
      const separatorIndex = trimmedCookie.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      if (trimmedCookie.slice(0, separatorIndex) !== key) {
        continue;
      }

      const value = trimmedCookie.slice(separatorIndex + 1);

      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }

    return undefined;
  }

  private async resolveGoTrueLoginContext({
    email,
    req,
    workspaceName,
  }: {
    email: string;
    req?: Request;
    workspaceName?: string;
  }): Promise<ResolveGoTrueLoginContextResult> {
    // Step 2: Resolve identity and tenant.
    // A brand-new user (no Twenty account yet) goes through first-login
    // provisioning. An existing user is bound to the workspace derived from the
    // request origin and MUST be a member of it — we never select a global
    // first/oldest workspace.
    const existingUser = await this.findUser(email);
    const isFirstLogin = !existingUser;

    let ctx: GoTrueLoginContext | null = null;

    // ── Unmanaged self-minted admin, closed (e51ca54c §10.6b) ───────────────
    // Reaching here means the login is UNMANAGED (no exe_perms entry applies to
    // this org, or EXE_ORG_ID is unset). For an EXISTING user that is harmless:
    // they are bound to the origin-resolved tenant they already belong to. But
    // for a FIRST login the native path calls signUpOnNewWorkspace, and
    // WorkspaceManagerService.setupDefaultRoles (workspace-manager.service.ts:
    // 119-135) hands that brand-new workspace's Admin role to this user. That
    // is an app minting its own admin — exactly what centralized role
    // administration must not allow.
    //
    // So it is refused BY DEFAULT, before the workspace-name prompt (asking for
    // a workspace name we will never create would be a worse experience than a
    // clear refusal). The error text is surfaced verbatim by the sign-in form
    // (twenty-front SignInUpWorkspaceScopeForm.tsx `credError`), so the user
    // gets an "ask your administrator" message — not a blank page and not a
    // bare 403.
    //
    // Genuine self-hosted bootstrap opts out with
    // CRM_REQUIRE_MANAGED_PERMS=false (logged loudly at startup).
    if (isFirstLogin && isManagedPermsRequired()) {
      this.logger.warn(
        `GoTrue login denied for ${email} — first login with no managed ` +
          'permissions; refusing to create a workspace or grant Admin. ' +
          '(CRM_REQUIRE_MANAGED_PERMS is on by default.)',
      );

      return {
        type: 'error',
        statusCode: 403,
        error:
          'Your account has no access to this CRM yet. Ask your administrator ' +
          'to invite you from the Exe dashboard.',
      };
    }

    // First login — need workspace name. If not provided, signal frontend to ask.
    if (isFirstLogin && !workspaceName) {
      return { type: 'needsSetup' };
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

        return {
          type: 'error',
          statusCode: 500,
          error: 'Failed to set up your workspace. Please try again.',
        };
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

        return {
          type: 'error',
          statusCode: 400,
          error: 'Unable to determine workspace for this request',
        };
      }

      if (!ctx.userWorkspace) {
        this.logger.warn(
          `GoTrue login denied for ${email} — not a member of workspace ${ctx.workspace.id}`,
        );

        return {
          type: 'error',
          statusCode: 403,
          error: 'You do not have access to this workspace',
        };
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

    return { type: 'success', ctx };
  }

  // NOTE: CRM does NOT provision Wiki accounts. The Wiki owns its own data
  // (public.workspaces / public.users / public.workspace_users) and provisions
  // its user lazily on first Wiki login via the shared GoTrue identity
  // (exe-wiki POST /api/request-token → resolveGoTrueUser). CRM writing those
  // tables directly violated the Wiki data-ownership boundary, duplicated the
  // Wiki's role-assignment / workspace-linking / audit-logging logic, and risked
  // schema drift. Cross-service provisioning must go through the owning service.

  // Public by design (sign-in entry point, same as sso-auth/google-auth):
  // identity is proven in-handler by GoTrue's password grant before any
  // token is issued, so PublicEndpointGuard + NoPermissionGuard is correct.
  @Post('gotrue-login')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
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

    // app_metadata carried by the GoTrue-issued access token. Captured below
    // (we STOP discarding the response) so we can enforce Exe unified perms.
    let gotrueAppMetadata: Record<string, unknown> | undefined;

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

      // Identity is proven by gotrueRes.ok. Instead of discarding the body,
      // read the access_token and decode its `app_metadata` (which GoTrue
      // authenticated moments ago) so we can apply the mapped CRM role. This
      // is the "stop discarding claims" point (unified-permissions §3.2C).
      const tokenBody = (await gotrueRes.json().catch(() => undefined)) as
        | { access_token?: string }
        | undefined;

      gotrueAppMetadata = decodeJwtAppMetadata(tokenBody?.access_token);
    } catch (err) {
      this.logger.error(`GoTrue request failed: ${err}`);

      return res
        .status(502)
        .json({ error: 'Authentication service unavailable' });
    }

    // Resolve this org's canonical CRM permission tier from the verified
    // claim. `managed: false` (no exe_perms for this org, or EXE_ORG_ID unset)
    // → existing native behavior is preserved end-to-end (backward compatible).
    const permsResolution = resolveExePermsForOrg(
      gotrueAppMetadata,
      this.exeOrgId,
    );

    // Managed-DENY: a managed user with no CRM capability (role `none` / empty
    // crm caps) must FAIL CLOSED — never provision, never mint a token, never
    // leave usable default access.
    if (permsResolution.managed && permsResolution.tier === 'none') {
      this.logger.warn(
        `GoTrue login denied for ${email} — managed org ${this.exeOrgId} grants no CRM access`,
      );

      return res
        .status(403)
        .json({ error: 'You do not have access to this workspace' });
    }

    // MANAGED login — the org ↔ workspace binding is authoritative. Resolve the
    // canonical workspace for this org and apply caps THERE (never new-workspace
    // provisioning, never request-origin binding).
    if (permsResolution.managed) {
      const existingUser = await this.findUser(email);
      const outcome = await this.resolveManagedLoginOutcome(
        email,
        existingUser,
        permsResolution.tier,
      );

      if (outcome.type === 'deny') {
        return res.status(outcome.statusCode).json({ error: outcome.error });
      }

      this.logger.log(
        `GoTrue managed login success for ${email} → /verify (tier ${permsResolution.tier})`,
      );

      return res.json({ redirectUrl: outcome.url });
    }

    const contextResult = await this.resolveGoTrueLoginContext({
      email,
      req,
      workspaceName,
    });

    if (contextResult.type === 'needsSetup') {
      return res.status(200).json({
        needsSetup: true,
        message: 'First login — please provide a workspace name.',
      });
    }

    if (contextResult.type === 'error') {
      return res
        .status(contextResult.statusCode)
        .json({ error: contextResult.error });
    }

    const { ctx } = contextResult;

    // NOTE: Exe unified-permissions enforcement is NOT applied on this
    // unmanaged path — `permsResolution.managed === false` means no exe_perms
    // entry applies to this org (or EXE_ORG_ID is unset), so native behavior is
    // preserved end-to-end. Managed logins are fully handled above and never
    // reach here.

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

  // Public by design (SSO bridge callback, same pattern as the OAuth
  // callbacks): the caller is not yet authenticated with the CRM — identity
  // is proven in-handler by cryptographically verifying the GoTrue JWT from
  // the exe_sess cookie; every failure path redirects to sign-in.
  //
  // Bridge contract: GoTrueCallbackRedirectEffect sends the browser here once
  // it sees the JS-readable exe_access_token=1 sentinel set alongside this
  // HttpOnly exe_sess cookie on the shared apex domain (companion exe-os PR).
  // The sentinel only triggers the bridge; exe_sess is the only auth proof.
  @Get('gotrue-callback')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async gotrueCallback(@Res() res: Response, @Req() req?: Request) {
    const signInRedirect = this.generateSignInRedirect();
    const goTrueSessionToken = this.getRequestCookie(req, 'exe_sess');

    if (!goTrueSessionToken || !this.gotrueUrl) {
      return res.redirect(signInRedirect);
    }

    try {
      // bug 74588d76: exe-auth stores the real GoTrue JWT in an HttpOnly
      // domain cookie; CRM must verify it cryptographically before bridging.
      const claims = await this.accessTokenService.verifyGoTrueToken(
        goTrueSessionToken,
        this.gotrueUrl,
      );
      const email = claims?.email;
      const subject = claims?.sub;

      if (!email || !subject) {
        this.logger.warn('GoTrue callback rejected: invalid token claims');

        return res.redirect(signInRedirect);
      }

      // Enforce Exe unified perms on the SSO-bridge path too — this endpoint
      // also mints a Twenty-native session, so it must fail closed for managed
      // orgs exactly like the password path. app_metadata is read from the
      // (already cryptographically verified) session JWT.
      const permsResolution = resolveExePermsForOrg(
        decodeJwtAppMetadata(goTrueSessionToken),
        this.exeOrgId,
      );

      if (permsResolution.managed) {
        if (permsResolution.tier === 'none') {
          this.logger.warn(
            `GoTrue callback denied for ${email} — managed org ${this.exeOrgId} grants no CRM access`,
          );

          return res.redirect(signInRedirect);
        }

        const existingUser = await this.findUser(email);
        const outcome = await this.resolveManagedLoginOutcome(
          email,
          existingUser,
          permsResolution.tier,
        );

        if (outcome.type === 'deny') {
          this.logger.warn(
            `GoTrue callback denied for ${email} — managed enforcement failed (${outcome.statusCode})`,
          );

          return res.redirect(signInRedirect);
        }

        this.logger.log(
          `GoTrue callback managed success for ${email} (tier ${permsResolution.tier})`,
        );

        return res.redirect(outcome.url);
      }

      const contextResult = await this.resolveGoTrueLoginContext({
        email,
        req,
      });

      if (contextResult.type !== 'success') {
        return res.redirect(signInRedirect);
      }

      const redirectUrl = await this.generateLoginTokenRedirect(
        contextResult.ctx.user.email,
        contextResult.ctx.workspace.id,
      );

      this.logger.log(`GoTrue callback success for ${email}`);

      return res.redirect(redirectUrl);
    } catch (err) {
      this.logger.warn(`GoTrue callback rejected: ${err}`);

      return res.redirect(signInRedirect);
    }
  }

  /**
   * Handle a MANAGED GoTrue login (this org has an `exe_perms` entry).
   *
   * Thin response-writing wrapper over {@link resolveManagedLoginOutcome} that
   * emits a JSON body (the POST /gotrue-login contract). The core enforcement
   * lives in resolveManagedLoginOutcome so the redirect-based /gotrue-callback
   * path can reuse it without duplicating any fail-closed logic.
   */
  private async handleManagedLogin(
    res: Response,
    email: string,
    existingUser: UserEntity | null,
    tier: CrmRoleTier,
  ): Promise<Response> {
    const outcome = await this.resolveManagedLoginOutcome(
      email,
      existingUser,
      tier,
    );

    if (outcome.type === 'deny') {
      return res.status(outcome.statusCode).json({ error: outcome.error });
    }

    this.logger.log(
      `GoTrue managed login success for ${email} → /verify (tier ${tier})`,
    );

    return res.json({ redirectUrl: outcome.url });
  }

  /**
   * Core MANAGED-login enforcement (unified-permissions §2), response-agnostic.
   *
   * Enforces the org ↔ workspace 1:1 binding:
   *   1. Resolve the canonical workspace from `EXE_ORG_WORKSPACE_ID`. If unset
   *      or missing → FAIL CLOSED (never mint a new workspace).
   *   2. Ensure the user is a member of that workspace, seated on a VERIFIED
   *      managed role (never the mutable `defaultRoleId`). If they can't be a
   *      member → FAIL CLOSED.
   *   3. Apply the caps → role mapping THERE. Any outcome other than
   *      applied/noop → FAIL CLOSED (never mint a session above the caps).
   */
  private async resolveManagedLoginOutcome(
    email: string,
    existingUser: UserEntity | null,
    tier: CrmRoleTier,
  ): Promise<ManagedLoginOutcome> {
    // (1) Canonical workspace binding is mandatory under managed enforcement.
    if (!this.exeOrgWorkspaceId) {
      this.logger.error(
        `Managed login for ${email} but EXE_ORG_WORKSPACE_ID is unset for org ${this.exeOrgId} — cannot bind to a canonical workspace`,
      );

      return {
        type: 'deny',
        statusCode: 500,
        error:
          'Your organization is not linked to a workspace. Contact your administrator.',
      };
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { id: this.exeOrgWorkspaceId },
    });

    if (!workspace) {
      this.logger.error(
        `Managed login for ${email}: canonical workspace ${this.exeOrgWorkspaceId} (org ${this.exeOrgId}) not found`,
      );

      return {
        type: 'deny',
        statusCode: 500,
        error:
          'Your organization workspace is unavailable. Contact your administrator.',
      };
    }

    // (2) Ensure membership in the canonical workspace with a VERIFIED role.
    let user = existingUser ?? (await this.findUser(email));
    let userWorkspace = user
      ? await this.userWorkspaceRepository.findOne({
          where: { userId: user.id, workspaceId: workspace.id },
        })
      : null;

    if (!userWorkspace) {
      // Resolve (and secure) the role we intend to seat this new member on
      // BEFORE creating the membership. We must NOT join on the mutable
      // `workspace.defaultRoleId` — a local admin can repoint it at Admin, and
      // if the subsequent role-sync then fails we'd have created an elevated
      // membership as residue. Binding the managed role from the start means a
      // failed sync can only ever leave a correctly-scoped (or no) membership.
      const seatRoleId = await this.roleSyncService.resolveAssignableRoleId({
        tier,
        workspaceId: workspace.id,
      });

      // The target role MUST be a VERIFIED role for EVERY tier — including
      // admin (the seeded Admin role, resolved by universalIdentifier). We
      // NEVER fall back to the mutable `workspace.defaultRoleId`: a local admin
      // could repoint it at a powerful custom role, so seating any managed user
      // (admin included) on it is the exact banned pattern. If the verified
      // role can't be secured, fail closed WITHOUT creating any membership.
      if (!seatRoleId) {
        this.logger.error(
          `Managed login denied for ${email} — ${tier} role could not be secured for workspace ${workspace.id}; not creating a membership`,
        );

        return {
          type: 'deny',
          statusCode: 500,
          error:
            'Your access could not be applied right now. Please try again or contact your administrator.',
        };
      }

      try {
        await this.signInUpService.signInUpOnExistingWorkspace({
          workspace,
          // Seat on the verified role only (never the mutable defaultRoleId).
          roleId: seatRoleId,
          userData: user
            ? { type: 'existingUser', existingUser: user }
            : {
                type: 'newUserWithPicture',
                newUserWithPicture: {
                  email,
                  firstName: email.split('@')[0] ?? 'User',
                  lastName: '',
                  picture: undefined,
                },
              },
        });
      } catch (err) {
        this.logger.warn(
          `Managed login denied for ${email} — cannot join canonical workspace ${workspace.id}: ${err}`,
        );

        return {
          type: 'deny',
          statusCode: 403,
          error: 'You do not have access to this workspace',
        };
      }

      user = await this.findUser(email);
      userWorkspace = user
        ? await this.userWorkspaceRepository.findOne({
            where: { userId: user.id, workspaceId: workspace.id },
          })
        : null;

      if (!user || !userWorkspace) {
        this.logger.error(
          `Managed login for ${email}: membership missing after provisioning into ${workspace.id}`,
        );

        return {
          type: 'deny',
          statusCode: 403,
          error: 'You do not have access to this workspace',
        };
      }
    }

    // Invariant: reaching here means the user is a member of the canonical
    // workspace. (When `userWorkspace` was already present, `user` is the member
    // it belongs to; the provisioning branch above re-fetches and guards both.)
    if (!user) {
      this.logger.error(
        `Managed login for ${email}: user missing for membership ${userWorkspace.id}`,
      );

      return {
        type: 'deny',
        statusCode: 403,
        error: 'You do not have access to this workspace',
      };
    }

    // (3) Enforce caps → role. GoTrue caps are authoritative: a managed user
    // must NOT be issued a session under a role that doesn't match their caps.
    // For EVERY tier (admin included) we only mint a session when enforcement
    // actually took effect — `applied` (re-pointed) or `noop` (already at the
    // correct role). Any other outcome means the role is in an elevated/unknown
    // state:
    //   - blocked_last_admin → the user is the sole admin and can't be demoted,
    //   - unresolved         → the target role (managed Member/Viewer, or the
    //                          seeded Admin) couldn't be secured,
    //   - error              → the assignment failed.
    // In all of those we FAIL CLOSED.
    const applied = await this.roleSyncService.applyCrmTier({
      userWorkspaceId: userWorkspace.id,
      workspaceId: workspace.id,
      tier,
    });

    if (applied.status !== 'applied' && applied.status !== 'noop') {
      this.logger.error(
        `Managed login denied for ${email} — ${tier} caps could not be enforced on workspace ${workspace.id} (status=${applied.status}); failing closed`,
      );

      if (applied.status === 'blocked_last_admin') {
        return {
          type: 'deny',
          statusCode: 403,
          error:
            'This workspace has no other authorized administrator, so your access cannot be granted. Contact your administrator.',
        };
      }

      // unresolved / error — enforcement is in an unknown state; never mint a
      // session that could leave the user above their caps.
      return {
        type: 'deny',
        statusCode: 500,
        error:
          'Your access could not be applied right now. Please try again or contact your administrator.',
      };
    }

    // Mint the Twenty-native login token bound to the canonical workspace.
    try {
      const url = await this.generateLoginTokenRedirect(
        user.email,
        workspace.id,
      );

      return { type: 'redirect', url };
    } catch (err) {
      this.logger.error(`Login token generation failed for ${email}: ${err}`);

      return {
        type: 'deny',
        statusCode: 500,
        error: 'Failed to generate session token',
      };
    }
  }

  // Public by design (login entry point): authentication happens in-handler —
  // fail-closed feature gate (isAdminTokenLoginEnabled) plus timing-safe
  // comparison of the presented token against ADMIN_TOKEN's sha256 hash.
  @Post('admin-token')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async adminTokenLogin(
    @Body() body: { token?: string },
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    // ── FIX (admin-token backdoor) — fail closed ──────────────────────────────
    // The React tab was hidden earlier, but this SERVER endpoint stayed
    // reachable. Gate it: disabled for MANAGED deployments (`EXE_ORG_ID` set —
    // no static-secret owner-impersonation backdoor is allowed) and OFF by
    // default otherwise (opt-in via `ENABLE_ADMIN_TOKEN_LOGIN=true`). Reject
    // with 401 before inspecting the token so a disabled deployment leaks
    // nothing about configuration state.
    if (!isAdminTokenLoginEnabled()) {
      this.logger.warn(
        'Admin-token login rejected — disabled (managed deployment or ' +
          'ENABLE_ADMIN_TOKEN_LOGIN not set)',
      );

      return res.status(401).json({ error: 'Authentication failed' });
    }

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

    // Bind the admin bypass to a workspace. In a MANAGED deployment
    // (EXE_ORG_WORKSPACE_ID set) PIN it to the canonical workspace and IGNORE
    // the client-controlled Host — otherwise a holder of the static admin token
    // could set the Host header to any tenant's domain and mint a session as
    // that tenant's owner (cross-tenant takeover). When unmanaged, fall back to
    // the origin-derived tenant (single-workspace break-glass, unchanged).
    const workspace = this.exeOrgWorkspaceId
      ? await this.workspaceRepository.findOne({
          where: { id: this.exeOrgWorkspaceId },
        })
      : await this.resolveWorkspaceFromRequest(req);

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
