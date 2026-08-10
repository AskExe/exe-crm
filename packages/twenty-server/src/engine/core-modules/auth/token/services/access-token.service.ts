import { createPublicKey, type JsonWebKey as CryptoJsonWebKey } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { addMilliseconds } from 'date-fns';
import { type Request } from 'express';
import ms from 'ms';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { assertIsDefinedOrThrow, isValidUuid } from 'twenty-shared/utils';
import { isWorkspaceActiveOrSuspended } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import * as jwt from 'jsonwebtoken';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import {
  decodeJwtAppMetadata,
  resolveExePermsForOrg,
} from 'src/engine/core-modules/auth/services/exe-perms.util';
import { type AuthToken } from 'src/engine/core-modules/auth/dto/auth-token.dto';
import { JwtAuthStrategy } from 'src/engine/core-modules/auth/strategies/jwt.auth.strategy';
import {
  type AccessTokenJwtPayload,
  type AuthContext,
  JwtTokenTypeEnum,
} from 'src/engine/core-modules/auth/types/auth-context.type';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceNotFoundDefaultError } from 'src/engine/core-modules/user-workspace/user-workspace.exception';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { userValidator } from 'src/engine/core-modules/user/user.validate';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceNotFoundDefaultError } from 'src/engine/core-modules/workspace/workspace.exception';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { isNativePasswordAuthDisabled } from 'src/engine/core-modules/auth/utils/is-native-password-auth-disabled.util';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

export type GoTrueJwtPayload = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  user_metadata?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    name?: string;
  };
};

type GoTrueJwk = {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  k?: string;
  [key: string]: unknown;
};

@Injectable()
export class AccessTokenService {
  private readonly logger = new Logger(AccessTokenService.name);
  private static readonly GOTRUE_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

  private gotrueJwksCache: {
    url: string;
    fetchedAt: number;
    keys: GoTrueJwk[];
  } | null = null;

  constructor(
    private readonly jwtWrapperService: JwtWrapperService,
    private readonly jwtStrategy: JwtAuthStrategy,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {}

  async generateAccessToken({
    userId,
    workspaceId,
    authProvider,
    isImpersonating,
    impersonatorUserWorkspaceId,
    impersonatedUserWorkspaceId,
  }: Omit<
    AccessTokenJwtPayload,
    'type' | 'workspaceMemberId' | 'userWorkspaceId' | 'sub'
  >): Promise<AuthToken> {
    if (
      authProvider === AuthProviderEnum.Password &&
      isNativePasswordAuthDisabled(this.twentyConfigService)
    ) {
      throw new AuthException(
        'Native password authentication is disabled when GOTRUE_URL is configured',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const expiresIn = this.twentyConfigService.get('ACCESS_TOKEN_EXPIRES_IN');

    const expiresAt = addMilliseconds(new Date().getTime(), ms(expiresIn));

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    userValidator.assertIsDefinedOrThrow(
      user,
      new AuthException('User is not found', AuthExceptionCode.INVALID_INPUT),
    );

    let tokenWorkspaceMemberId: string | undefined;

    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    assertIsDefinedOrThrow(workspace, WorkspaceNotFoundDefaultError);

    if (isWorkspaceActiveOrSuspended(workspace)) {
      const authContext = buildSystemAuthContext(workspaceId);

      tokenWorkspaceMemberId =
        await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
          async () => {
            const workspaceMemberRepository =
              await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
                workspaceId,
                'workspaceMember',
                { shouldBypassPermissionChecks: true },
              );

            const workspaceMember = await workspaceMemberRepository.findOne({
              where: {
                userId: user.id,
              },
            });

            assertIsDefinedOrThrow(
              workspaceMember,
              new AuthException(
                'User is not a member of the workspace',
                AuthExceptionCode.FORBIDDEN_EXCEPTION,
                {
                  userFriendlyMessage: msg`User is not a member of the workspace.`,
                },
              ),
            );

            return workspaceMember.id;
          },
          authContext,
        );
    }
    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: {
        userId: user.id,
        workspaceId,
      },
    });

    assertIsDefinedOrThrow(userWorkspace, UserWorkspaceNotFoundDefaultError);

    const payloadImpersonatorUserWorkspaceId =
      isImpersonating === true ? impersonatorUserWorkspaceId : undefined;
    const payloadOriginalUserWorkspaceId =
      isImpersonating === true ? impersonatedUserWorkspaceId : undefined;

    const jwtPayload: AccessTokenJwtPayload = {
      sub: user.id,
      userId: user.id,
      workspaceId,
      workspaceMemberId: tokenWorkspaceMemberId,
      userWorkspaceId: userWorkspace.id,
      type: JwtTokenTypeEnum.ACCESS,
      authProvider,
      isImpersonating: isImpersonating === true,
      impersonatorUserWorkspaceId: payloadImpersonatorUserWorkspaceId,
      impersonatedUserWorkspaceId: payloadOriginalUserWorkspaceId,
    };

    return {
      token: this.jwtWrapperService.sign(jwtPayload, {
        secret: this.jwtWrapperService.generateAppSecret(
          JwtTokenTypeEnum.ACCESS,
          workspaceId,
        ),
        expiresIn,
      }),
      expiresAt,
    };
  }

  async validateToken(token: string): Promise<AuthContext> {
    await this.jwtWrapperService.verifyJwtToken(token);

    const decoded = this.jwtWrapperService.decode<AccessTokenJwtPayload>(token);

    const context = await this.jwtStrategy.validate(decoded);

    return context;
  }

  async validateTokenByRequest(request: Request): Promise<AuthContext> {
    const token = this.jwtWrapperService.extractJwtFromRequest()(request);

    if (!token) {
      throw new AuthException(
        'Missing authentication token',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    try {
      return await this.validateToken(token);
    } catch (error) {
      const gotrueContext = await this.tryValidateGoTrueToken(token, request);

      if (gotrueContext) {
        return gotrueContext;
      }

      throw error;
    }
  }

  private async tryValidateGoTrueToken(
    token: string,
    request: Request,
  ): Promise<AuthContext | null> {
    const gotrueUrl = this.twentyConfigService.get('GOTRUE_URL');

    if (!gotrueUrl) {
      return null;
    }

    // ── P0 46a09952 — Exe unified-permissions enforcement (FAIL CLOSED) ──────
    // The bearer-GoTrue fallback exchanges a raw GoTrue JWT for CRM access by
    // auto-provisioning a workspace membership with NO roleId — which
    // ultimately seats the user on the mutable workspace.defaultRoleId (WRITE).
    // That bypasses exe_perms entirely: a centrally-DENIED (tier `none`) user is
    // admitted, and a `crm:read` user is granted WRITE.
    //
    // The caps→role mapping can only be seated/verified through the login-time
    // RoleSyncService flow (GoTrueAuthController.resolveManagedLoginOutcome),
    // which is NOT reachable from this per-request token path without pulling a
    // metadata-module service into the @Global TokenModule (a DI cycle:
    // AuthModule already imports TokenModule). Since we cannot apply the tier
    // here, we FAIL CLOSED whenever this deployment enforces CRM RBAC
    // (`EXE_ORG_ID` set): the bearer-GoTrue exchange is disabled and the caller
    // must instead use the enforced browser login, which mints a Twenty-native
    // token that validates on the PRIMARY `validateToken` path (unaffected).
    //
    // Non-managed deployments (`EXE_ORG_ID` unset) keep the native fallback —
    // fully backward compatible.
    const exeOrgId = process.env.EXE_ORG_ID;

    if (exeOrgId) {
      const perms = resolveExePermsForOrg(
        decodeJwtAppMetadata(token),
        exeOrgId,
      );
      const tier = perms.managed ? perms.tier : 'unmanaged/no-grant';

      this.logger.warn(
        `bearer-GoTrue exchange disabled under CRM RBAC enforcement ` +
          `(org ${exeOrgId}, tier ${tier}); requiring enforced browser login. ` +
          `Failing closed (bug 46a09952).`,
      );

      return null;
    }

    let claims: GoTrueJwtPayload | null;

    try {
      claims = await this.verifyGoTrueToken(token, gotrueUrl);
    } catch {
      return null;
    }

    if (!claims) {
      return null;
    }

    const workspace = await this.resolveWorkspaceForGoTrueRequest(request);

    if (!workspace) {
      return null;
    }

    const {
      user,
      userWorkspace,
      workspaceMember,
      userChanged,
      userWorkspaceChanged,
      workspaceMemberChanged,
    } = await this.provisionGoTrueWorkspaceAccess(claims, workspace);

    if (userChanged) {
      await this.coreEntityCacheService.invalidateAndRecompute('user', user.id);
    }

    if (userWorkspaceChanged) {
      await this.coreEntityCacheService.invalidateAndRecompute(
        'userWorkspaceEntity',
        userWorkspace.id,
      );
    }

    if (workspaceMemberChanged) {
      await this.workspaceCacheService.invalidateAndRecompute(workspace.id, [
        'flatWorkspaceMemberMaps',
      ]);
    }

    const [cachedUser, cachedUserWorkspace, cachedWorkspace] =
      await Promise.all([
        this.coreEntityCacheService.get('user', user.id),
        this.coreEntityCacheService.get(
          'userWorkspaceEntity',
          userWorkspace.id,
        ),
        this.coreEntityCacheService.get('workspaceEntity', workspace.id),
      ]);

    assertIsDefinedOrThrow(
      cachedUser,
      new AuthException('User not found', AuthExceptionCode.USER_NOT_FOUND),
    );

    assertIsDefinedOrThrow(
      cachedUserWorkspace,
      new AuthException(
        'UserWorkspaceEntity not found',
        AuthExceptionCode.USER_WORKSPACE_NOT_FOUND,
      ),
    );

    assertIsDefinedOrThrow(
      cachedWorkspace,
      new AuthException(
        'Workspace not found',
        AuthExceptionCode.WORKSPACE_NOT_FOUND,
      ),
    );

    return {
      user: cachedUser,
      workspace: cachedWorkspace,
      userWorkspace: cachedUserWorkspace,
      userWorkspaceId: cachedUserWorkspace.id,
      workspaceMemberId: workspaceMember.id,
      workspaceMember,
      authProvider: AuthProviderEnum.SSO,
    };
  }

  async verifyGoTrueToken(
    token: string,
    gotrueUrl: string,
  ): Promise<GoTrueJwtPayload | null> {
    const decoded = jwt.decode(token, {
      complete: true,
      json: true,
    }) as {
      header?: jwt.JwtHeader;
      payload?: string | jwt.JwtPayload | null;
    } | null;

    if (!decoded?.header?.alg || !decoded.payload) {
      return null;
    }

    const algorithm = decoded.header.alg as jwt.Algorithm;

    if (!this.isSupportedGoTrueAlgorithm(algorithm)) {
      return null;
    }

    const jwk = await this.getGoTrueJwk(gotrueUrl, decoded.header.kid);

    // bug 550d6ab7: GoTrue deliberately omits HMAC keys from its JWKS endpoint
    // (internal/api/jwks.go skips `jwa.OctetSeq` keys — publishing the `k`
    // member would leak GOTRUE_JWT_SECRET to the internet). A symmetric GoTrue
    // therefore always serves `{"keys":[]}`, so requiring a JWK made this whole
    // path unsatisfiable: no correctly-signed token could ever be accepted.
    // Fall back to the configured shared secret for HS256 only — see
    // getGoTrueSymmetricVerificationKey for the algorithm-confusion analysis.
    const verificationKey = jwk
      ? this.getGoTrueVerificationKey(jwk)
      : this.getGoTrueSymmetricVerificationKey(algorithm);

    if (!verificationKey) {
      return null;
    }

    const verified = jwt.verify(token, verificationKey, {
      algorithms: [algorithm],
      audience: this.getGoTrueAudience(),
      issuer: this.getGoTrueIssuers(gotrueUrl),
      ignoreExpiration: false,
      ignoreNotBefore: false,
    });

    if (typeof verified === 'string') {
      return null;
    }

    const email = this.getGoTrueEmail(verified as GoTrueJwtPayload);

    if (!email) {
      return null;
    }

    return {
      ...(verified as GoTrueJwtPayload),
      email,
    };
  }

  private async getGoTrueJwk(
    gotrueUrl: string,
    kid?: string,
  ): Promise<GoTrueJwk | null> {
    const now = Date.now();
    const shouldRefresh =
      !this.gotrueJwksCache ||
      this.gotrueJwksCache.url !== gotrueUrl ||
      now - this.gotrueJwksCache.fetchedAt >
        AccessTokenService.GOTRUE_JWKS_CACHE_TTL_MS;

    if (shouldRefresh) {
      this.gotrueJwksCache = await this.fetchGoTrueJwks(gotrueUrl);
    }

    let jwk = this.selectGoTrueJwk(this.gotrueJwksCache?.keys ?? [], kid);

    if (!jwk && !shouldRefresh) {
      this.gotrueJwksCache = await this.fetchGoTrueJwks(gotrueUrl);
      jwk = this.selectGoTrueJwk(this.gotrueJwksCache?.keys ?? [], kid);
    }

    return jwk;
  }

  private async fetchGoTrueJwks(gotrueUrl: string): Promise<{
    url: string;
    fetchedAt: number;
    keys: GoTrueJwk[];
  }> {
    const jwksUrl = new URL('/.well-known/jwks.json', gotrueUrl);
    const response = await fetch(jwksUrl);

    if (!response.ok) {
      throw new AuthException(
        'Unable to fetch GoTrue JWKS',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    const payload = (await response.json()) as { keys?: GoTrueJwk[] };

    // A malformed JWKS must NOT be coerced to an empty key set: an empty set is
    // meaningful evidence that the deployment signs symmetrically, and that
    // evidence gates the HS256 shared-secret fallback below. Garbage in must
    // fail, not silently look like a symmetric GoTrue. An explicitly empty
    // `keys: []` is legitimate — that is exactly what a symmetric GoTrue serves.
    if (!Array.isArray(payload.keys)) {
      throw new AuthException(
        'Malformed GoTrue JWKS response',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    return {
      url: gotrueUrl,
      fetchedAt: Date.now(),
      keys: payload.keys,
    };
  }

  private selectGoTrueJwk(keys: GoTrueJwk[], kid?: string): GoTrueJwk | null {
    if (kid) {
      return keys.find((key) => key.kid === kid) ?? null;
    }

    return keys.length === 1 ? keys[0] : null;
  }

  private getGoTrueVerificationKey(
    jwk: GoTrueJwk,
  ): jwt.Secret | ReturnType<typeof createPublicKey> {
    if (jwk.kty === 'oct' && typeof jwk.k === 'string') {
      return Buffer.from(jwk.k, 'base64url');
    }

    return createPublicKey({
      key: jwk as CryptoJsonWebKey,
      format: 'jwk',
    });
  }

  /**
   * Resolves the verification key for a symmetric GoTrue deployment, where the
   * JWKS endpoint legitimately advertises no usable key.
   *
   * ALGORITHM-CONFUSION ANALYSIS (bug 550d6ab7)
   *
   * The classic downgrade attack is: the server publishes an RSA public key,
   * the attacker re-signs a token as `alg: HS256` using the *public key bytes*
   * as the HMAC secret, and a naive verifier — which picks its key from the
   * JWKS but its algorithm from the token header — accepts it.
   *
   * This fallback is not vulnerable to that, on four independent grounds:
   *
   *  1. The key material here is `GOTRUE_JWT_SECRET`, a server-side secret that
   *     is never published anywhere. A JWKS public key is NEVER used as an HMAC
   *     secret on any code path. Forging an HS256 token therefore requires the
   *     secret itself, which is the same bar GoTrue sets.
   *  2. The fallback refuses to fire when the JWKS advertises ANY asymmetric
   *     key. An attacker cannot force an asymmetric deployment down this path
   *     by inventing a `kid` that misses the key set, because the key set is
   *     inspected, not just the lookup result.
   *  3. It is gated on HS256 specifically, not on "JWKS lookup failed". A
   *     genuine key-id mismatch on an asymmetric deployment still fails hard
   *     rather than being papered over.
   *  4. `jwt.verify` is still pinned to `algorithms: [algorithm]`, so `none`
   *     and every algorithm outside the supported list remain rejected, and the
   *     issuer / audience / expiry / nbf assertions are unchanged — this method
   *     only decides WHERE the key comes from, never WHAT is asserted.
   *
   * Fails closed: returns null (→ token rejected) when the algorithm is not
   * HS256, when the deployment looks asymmetric, or when no secret is set.
   */
  private getGoTrueSymmetricVerificationKey(
    algorithm: jwt.Algorithm,
  ): jwt.Secret | null {
    if (algorithm !== 'HS256') {
      return null;
    }

    const advertisedKeys = this.gotrueJwksCache?.keys ?? [];
    const advertisesAsymmetricKey = advertisedKeys.some(
      (key) => key.kty !== 'oct',
    );

    if (advertisesAsymmetricKey) {
      this.logger.warn(
        'Refusing HS256 GoTrue token: JWKS advertises asymmetric keys, so the ' +
          'shared-secret fallback does not apply (possible algorithm-confusion attempt).',
      );

      return null;
    }

    const sharedSecret = this.twentyConfigService.get('GOTRUE_JWT_SECRET');

    if (typeof sharedSecret !== 'string' || sharedSecret.length === 0) {
      this.logger.warn(
        'Refusing HS256 GoTrue token: GoTrue publishes no verification key ' +
          '(symmetric signing) and GOTRUE_JWT_SECRET is not configured.',
      );

      return null;
    }

    return sharedSecret;
  }

  private isSupportedGoTrueAlgorithm(
    algorithm: jwt.Algorithm,
  ): algorithm is jwt.Algorithm {
    return [
      'HS256',
      'HS384',
      'HS512',
      'RS256',
      'RS384',
      'RS512',
      'ES256',
      'ES384',
      'ES512',
    ].includes(algorithm);
  }

  private getGoTrueAudience() {
    return this.twentyConfigService.get('GOTRUE_JWT_AUDIENCE');
  }

  private getGoTrueIssuers(gotrueUrl: string): [string, ...string[]] {
    const configuredIssuer = this.twentyConfigService.get('GOTRUE_JWT_ISSUER');

    if (configuredIssuer) {
      return [configuredIssuer];
    }

    const normalizedGoTrueUrl = new URL(gotrueUrl)
      .toString()
      .replace(/\/$/, '');
    const authV1Issuer = new URL('/auth/v1', gotrueUrl)
      .toString()
      .replace(/\/$/, '');

    const unique = [...new Set([normalizedGoTrueUrl, authV1Issuer])];

    return unique as [string, ...string[]];
  }

  private getGoTrueEmail(claims: GoTrueJwtPayload): string | null {
    const email =
      claims.email ??
      (typeof claims.user_metadata?.email === 'string'
        ? claims.user_metadata.email
        : undefined);

    if (!email) {
      return null;
    }

    return email.trim().toLowerCase();
  }

  private async resolveWorkspaceForGoTrueRequest(
    request: Request,
  ): Promise<WorkspaceEntity | null> {
    // ── P1 40c819df — canonical org↔workspace binding wins over client input ──
    // In multiworkspace mode the tenant was derived purely from the
    // client-controlled Origin / X-Forwarded-Host, with no membership or
    // exe_perms guard — so a GoTrue holder could steer provisioning into an
    // arbitrary workspace by forging those headers. When this deployment pins a
    // canonical workspace (`EXE_ORG_WORKSPACE_ID`, org↔workspace 1:1), resolve
    // THAT workspace and IGNORE the request headers entirely. (Under managed
    // enforcement the bearer path is already failed-closed above; this keeps the
    // binding correct as defense-in-depth for any non-enforced caller.)
    const exeOrgWorkspaceId = process.env.EXE_ORG_WORKSPACE_ID;

    if (exeOrgWorkspaceId) {
      return (
        (await this.workspaceRepository.findOne({
          where: { id: exeOrgWorkspaceId },
        })) ?? null
      );
    }

    const requestOrigin = this.getRequestOrigin(request);

    if (!requestOrigin) {
      return null;
    }

    return (
      (await this.workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
        requestOrigin,
      )) ?? null
    );
  }

  private getRequestOrigin(request: Request): string | null {
    const originHeader = request.headers.origin;

    if (typeof originHeader === 'string' && originHeader.length > 0) {
      return originHeader;
    }

    const forwardedHost = request.headers['x-forwarded-host'];
    const host =
      typeof forwardedHost === 'string' && forwardedHost.length > 0
        ? forwardedHost.split(',')[0]?.trim()
        : Array.isArray(request.headers.host)
          ? request.headers.host[0]
          : request.headers.host;

    if (typeof host === 'string' && host.length > 0) {
      const forwardedProto = request.headers['x-forwarded-proto'];
      const protocol =
        typeof forwardedProto === 'string' && forwardedProto.length > 0
          ? forwardedProto.split(',')[0]?.trim()
          : request.protocol || 'https';

      return `${protocol}://${host}`;
    }

    return this.twentyConfigService.get('FRONTEND_URL') ?? null;
  }

  private async provisionGoTrueWorkspaceAccess(
    claims: GoTrueJwtPayload,
    workspace: WorkspaceEntity,
  ): Promise<{
    user: UserEntity;
    userWorkspace: UserWorkspaceEntity;
    workspaceMember: WorkspaceMemberWorkspaceEntity;
    userChanged: boolean;
    userWorkspaceChanged: boolean;
    workspaceMemberChanged: boolean;
  }> {
    const userId = claims.sub;
    const email = this.getGoTrueEmail(claims);

    if (!userId || !isValidUuid(userId) || !email) {
      throw new AuthException(
        'Invalid GoTrue token claims',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    let userChanged = false;
    let user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      user = await this.userRepository.findOne({
        where: { email },
      });
    }

    if (!user) {
      const { firstName, lastName } = this.extractNameFromGoTrueClaims(
        claims,
        email,
      );

      user = await this.userRepository.save(
        this.userRepository.create({
          id: userId,
          email,
          firstName,
          lastName,
          isEmailVerified: true,
          locale: SOURCE_LOCALE,
        }),
      );

      userChanged = true;
    } else if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      user = await this.userRepository.save(user);
      userChanged = true;
    }

    let userWorkspaceChanged = false;
    let workspaceMemberChanged = false;
    let userWorkspace = await this.userWorkspaceRepository.findOne({
      where: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    });

    if (!userWorkspace) {
      await this.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(
        user,
        workspace,
      );

      userWorkspace = await this.userWorkspaceRepository.findOne({
        where: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      });

      userWorkspaceChanged = true;
      workspaceMemberChanged = true;
    }

    assertIsDefinedOrThrow(userWorkspace, UserWorkspaceNotFoundDefaultError);

    let workspaceMember = await this.findWorkspaceMemberByUserId(
      workspace.id,
      user.id,
    );

    if (!workspaceMember) {
      await this.userWorkspaceService.createWorkspaceMember(workspace.id, user);
      workspaceMember = await this.findWorkspaceMemberByUserId(
        workspace.id,
        user.id,
      );
      workspaceMemberChanged = true;
    }

    assertIsDefinedOrThrow(
      workspaceMember,
      new AuthException(
        'User is not a member of the workspace',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
        {
          userFriendlyMessage: msg`User is not a member of the workspace.`,
        },
      ),
    );

    return {
      user,
      userWorkspace,
      workspaceMember,
      userChanged,
      userWorkspaceChanged,
      workspaceMemberChanged,
    };
  }

  private extractNameFromGoTrueClaims(
    claims: GoTrueJwtPayload,
    email: string,
  ): {
    firstName: string;
    lastName: string;
  } {
    const firstName =
      claims.user_metadata?.first_name ?? claims.given_name ?? '';
    const lastName =
      claims.user_metadata?.last_name ?? claims.family_name ?? '';
    const fullName =
      claims.user_metadata?.full_name ??
      claims.user_metadata?.name ??
      claims.name ??
      '';

    if (firstName || lastName) {
      return {
        firstName,
        lastName,
      };
    }

    if (fullName.trim().length > 0) {
      const [resolvedFirstName, ...rest] = fullName.trim().split(/\s+/);

      return {
        firstName: resolvedFirstName ?? '',
        lastName: rest.join(' '),
      };
    }

    return {
      firstName: email.split('@')[0] ?? '',
      lastName: '',
    };
  }

  private async findWorkspaceMemberByUserId(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberWorkspaceEntity | null> {
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const workspaceMemberRepository =
          await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
            workspaceId,
            'workspaceMember',
            { shouldBypassPermissionChecks: true },
          );

        return await workspaceMemberRepository.findOne({
          where: {
            userId,
          },
        });
      },
      authContext,
    );
  }
}
