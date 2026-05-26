import { createPublicKey, type JsonWebKey as CryptoJsonWebKey } from 'crypto';
import { Injectable } from '@nestjs/common';
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

type GoTrueJwtPayload = jwt.JwtPayload & {
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

  private async verifyGoTrueToken(
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

    if (!jwk) {
      return null;
    }

    const verified = jwt.verify(token, this.getGoTrueVerificationKey(jwk), {
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

    return {
      url: gotrueUrl,
      fetchedAt: Date.now(),
      keys: Array.isArray(payload.keys) ? payload.keys : [],
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
