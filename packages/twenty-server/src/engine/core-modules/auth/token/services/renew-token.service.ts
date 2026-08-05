import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { IsNull, Repository } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type AuthToken } from 'src/engine/core-modules/auth/dto/auth-token.dto';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { WorkspaceAgnosticTokenService } from 'src/engine/core-modules/auth/token/services/workspace-agnostic-token.service';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/auth-context.type';
import { isNativePasswordAuthDisabled } from 'src/engine/core-modules/auth/utils/is-native-password-auth-disabled.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

@Injectable()
export class RenewTokenService {
  constructor(
    @InjectRepository(AppTokenEntity)
    private readonly appTokenRepository: Repository<AppTokenEntity>,
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceAgnosticTokenService: WorkspaceAgnosticTokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async generateTokensFromRefreshToken(token: string): Promise<{
    accessOrWorkspaceAgnosticToken: AuthToken;
    refreshToken: AuthToken;
  }> {
    if (!token) {
      throw new AuthException(
        'Refresh token not found',
        AuthExceptionCode.INVALID_INPUT,
      );
    }

    const {
      user,
      token: { id, workspaceId },
      authProvider,
      targetedTokenType: targetedTokenTypeFromPayload,
      isImpersonating,
      impersonatorUserWorkspaceId,
      impersonatedUserWorkspaceId,
    } = await this.refreshTokenService.verifyRefreshToken(token);

    // ── FIX (managed CRM RBAC) — Exe unified-permissions enforcement (FAIL CLOSED) ──
    // A native renewal renews a Twenty-native refresh token WITHOUT re-reading
    // GoTrue or re-applying exe_perms. A managed user who logged in as
    // `crm:write` and was later CENTRALLY DOWNGRADED to `crm:read`/`none` in
    // GoTrue could otherwise keep their prior WRITE/ADMIN tier indefinitely by
    // renewing the old refresh token — the downgrade/deny would never take
    // effect locally.
    //
    // exe_perms can only be re-seated/verified through the login-time
    // RoleSyncService flow (GoTrueAuthController.resolveManagedLoginOutcome),
    // which is NOT reachable from this per-request token path without pulling a
    // metadata-module service into the @Global TokenModule (a DI cycle:
    // AuthModule already imports TokenModule). Since we cannot re-resolve the
    // GoTrue caps here (we only hold a Twenty-native refresh token, not the
    // GoTrue JWT) nor re-apply the tier, we FAIL CLOSED: when this deployment
    // enforces CRM RBAC (`EXE_ORG_ID` set) AND the session originated from
    // GoTrue SSO (`authProvider === SSO` — the only SSO IdP under managed
    // enforcement, minted by /gotrue-login → /gotrue-callback), native renewal
    // is refused. The caller must sign in again through GoTrue, which
    // re-resolves exe_perms and re-applies the current tier. Mirrors the
    // bearer-path decision (bug 46a09952).
    //
    // Non-managed deployments (`EXE_ORG_ID` unset) keep native renewal — fully
    // backward compatible.
    if (process.env.EXE_ORG_ID && authProvider === AuthProviderEnum.SSO) {
      throw new AuthException(
        'Session renewal is disabled under CRM permission enforcement; please sign in again.',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    // Revoke old refresh token only if not already revoked.
    // If it was already revoked (concurrent race condition within grace
    // period), we preserve the original revokedAt timestamp so the grace
    // window stays anchored and cannot be extended by repeated reuse.
    await this.appTokenRepository.update(
      {
        id,
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );

    // Support legacy token when targetedTokenType is undefined.
    const targetedTokenType =
      targetedTokenTypeFromPayload ?? JwtTokenTypeEnum.ACCESS;

    const resolvedAuthProvider = authProvider ?? AuthProviderEnum.Password;

    if (
      resolvedAuthProvider === AuthProviderEnum.Password &&
      isNativePasswordAuthDisabled(this.twentyConfigService)
    ) {
      throw new AuthException(
        'Native password authentication is disabled when GOTRUE_URL is configured',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const accessToken =
      isDefined(authProvider) &&
      targetedTokenType === JwtTokenTypeEnum.WORKSPACE_AGNOSTIC &&
      !isDefined(workspaceId)
        ? await this.workspaceAgnosticTokenService.generateWorkspaceAgnosticToken(
            {
              userId: user.id,
              authProvider,
            },
          )
        : await this.accessTokenService.generateAccessToken({
            userId: user.id,
            workspaceId: workspaceId as string,
            authProvider: resolvedAuthProvider,
            isImpersonating,
            impersonatorUserWorkspaceId,
            impersonatedUserWorkspaceId,
          });

    const refreshToken = await this.refreshTokenService.generateRefreshToken({
      userId: user.id,
      workspaceId,
      authProvider: resolvedAuthProvider,
      targetedTokenType,
      isImpersonating,
      impersonatorUserWorkspaceId,
      impersonatedUserWorkspaceId,
    });

    return {
      accessOrWorkspaceAgnosticToken: accessToken,
      refreshToken,
    };
  }
}
