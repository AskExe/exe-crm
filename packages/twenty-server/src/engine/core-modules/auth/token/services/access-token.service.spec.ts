import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { generateKeyPairSync, randomUUID } from 'crypto';

import { type Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { AuthException } from 'src/engine/core-modules/auth/auth.exception';
import { JwtAuthStrategy } from 'src/engine/core-modules/auth/strategies/jwt.auth.strategy';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  let service: AccessTokenService;
  let jwtWrapperService: JwtWrapperService;
  let twentyConfigService: TwentyConfigService;
  let userRepository: Repository<UserEntity>;
  let workspaceRepository: Repository<WorkspaceEntity>;
  let globalWorkspaceOrmManager: GlobalWorkspaceOrmManager;
  let userWorkspaceRepository: Repository<UserWorkspaceEntity>;
  let workspaceDomainsService: WorkspaceDomainsService;
  let userWorkspaceService: UserWorkspaceService;
  let coreEntityCacheService: CoreEntityCacheService;
  let workspaceCacheService: WorkspaceCacheService;
  const originalFetch = global.fetch;
  const mockConfig = (overrides: Record<string, unknown> = {}) => {
    (twentyConfigService.get as jest.Mock).mockImplementation((key: string) => {
      const values: Record<string, unknown> = {
        ACCESS_TOKEN_EXPIRES_IN: '1h',
        GOTRUE_JWT_AUDIENCE: 'authenticated',
        ...overrides,
      };

      return values[key];
    });
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessTokenService,
        {
          provide: JwtWrapperService,
          useValue: {
            sign: jest.fn(),
            verifyJwtToken: jest.fn(),
            decode: jest.fn(),
            generateAppSecret: jest.fn(),
            extractJwtFromRequest: jest.fn(),
          },
        },
        {
          provide: JwtAuthStrategy,
          useValue: {
            validate: jest.fn(),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: WorkspaceDomainsService,
          useValue: {
            getWorkspaceByOriginOrDefaultWorkspace: jest.fn(),
          },
        },
        {
          provide: UserWorkspaceService,
          useValue: {
            addUserToWorkspaceIfUserNotInWorkspace: jest.fn(),
            createWorkspaceMember: jest.fn(),
          },
        },
        {
          provide: CoreEntityCacheService,
          useValue: {
            get: jest.fn(),
            invalidateAndRecompute: jest.fn(),
          },
        },
        {
          provide: WorkspaceCacheService,
          useValue: {
            invalidateAndRecompute: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(AppTokenEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useClass: Repository,
        },
        {
          provide: EmailService,
          useValue: {},
        },
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: {
            getRepository: jest.fn(),
            executeInWorkspaceContext: jest
              .fn()
              .mockImplementation((fn: () => any, _authContext?: any) => fn()),
          },
        },
      ],
    }).compile();

    service = module.get<AccessTokenService>(AccessTokenService);
    jwtWrapperService = module.get<JwtWrapperService>(JwtWrapperService);
    twentyConfigService = module.get<TwentyConfigService>(TwentyConfigService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    workspaceRepository = module.get<Repository<WorkspaceEntity>>(
      getRepositoryToken(WorkspaceEntity),
    );
    globalWorkspaceOrmManager = module.get<GlobalWorkspaceOrmManager>(
      GlobalWorkspaceOrmManager,
    );
    userWorkspaceRepository = module.get<Repository<UserWorkspaceEntity>>(
      getRepositoryToken(UserWorkspaceEntity),
    );
    workspaceDomainsService = module.get<WorkspaceDomainsService>(
      WorkspaceDomainsService,
    );
    userWorkspaceService =
      module.get<UserWorkspaceService>(UserWorkspaceService);
    coreEntityCacheService = module.get<CoreEntityCacheService>(
      CoreEntityCacheService,
    );
    workspaceCacheService = module.get<WorkspaceCacheService>(
      WorkspaceCacheService,
    );
    mockConfig();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAccessToken', () => {
    it('should generate an access token successfully', async () => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const mockUser = {
        id: userId,
      };
      const mockWorkspace = {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        id: workspaceId,
      };
      const mockUserWorkspace = { id: randomUUID() };
      const mockWorkspaceMember = { id: randomUUID() };
      const mockToken = 'mock-token';

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockUser as UserEntity);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace as WorkspaceEntity);
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockResolvedValue(mockUserWorkspace as UserWorkspaceEntity);
      jest.spyOn(globalWorkspaceOrmManager, 'getRepository').mockResolvedValue({
        findOne: jest.fn().mockResolvedValue(mockWorkspaceMember),
      } as any);
      jest.spyOn(jwtWrapperService, 'sign').mockReturnValue(mockToken);

      const result = await service.generateAccessToken({
        userId,
        workspaceId,
        authProvider: AuthProviderEnum.Password,
      });

      expect(result).toEqual({
        token: mockToken,
        expiresAt: expect.any(Date),
      });
      expect(jwtWrapperService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: userId,
          workspaceId: workspaceId,
          workspaceMemberId: mockWorkspaceMember.id,
        }),
        expect.any(Object),
      );
    });

    it('embeds impersonation claims when provided', async () => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const impersonatorUserWorkspaceId = randomUUID();
      const impersonatedUserWorkspaceId = randomUUID();
      const mockUser = { id: userId } as UserEntity;
      const mockWorkspace = {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        id: workspaceId,
      } as WorkspaceEntity;
      const mockUserWorkspace = {
        id: impersonatedUserWorkspaceId,
      } as UserWorkspaceEntity;
      const mockWorkspaceMember = { id: randomUUID() };
      const mockToken = 'mock-token';

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockUser as UserEntity);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace as WorkspaceEntity);
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockResolvedValueOnce(mockUserWorkspace as UserWorkspaceEntity)
        .mockResolvedValueOnce({
          id: impersonatorUserWorkspaceId,
          workspaceId,
        } as UserWorkspaceEntity)
        .mockResolvedValueOnce({
          id: impersonatedUserWorkspaceId,
          workspaceId,
        } as UserWorkspaceEntity);
      jest.spyOn(globalWorkspaceOrmManager, 'getRepository').mockResolvedValue({
        findOne: jest.fn().mockResolvedValue(mockWorkspaceMember),
      } as any);
      const signSpy = jest
        .spyOn(jwtWrapperService, 'sign')
        .mockReturnValue(mockToken);

      await service.generateAccessToken({
        userId,
        workspaceId,
        authProvider: AuthProviderEnum.Impersonation,
        isImpersonating: true,
        impersonatorUserWorkspaceId: impersonatorUserWorkspaceId,
        impersonatedUserWorkspaceId: impersonatedUserWorkspaceId,
      });

      expect(signSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isImpersonating: true,
          impersonatorUserWorkspaceId: impersonatorUserWorkspaceId,
          impersonatedUserWorkspaceId: impersonatedUserWorkspaceId,
        }),
        expect.any(Object),
      );
    });

    it('should throw an error if user is not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.generateAccessToken({
          userId: 'non-existent-user',
          workspaceId: 'workspace-id',
          authProvider: AuthProviderEnum.Password,
        }),
      ).rejects.toThrow(AuthException);
    });

    it('rejects native password access tokens when GOTRUE_URL is configured', async () => {
      mockConfig({
        GOTRUE_URL: 'http://gotrue:9999',
      });
      const findOneSpy = jest.spyOn(userRepository, 'findOne');

      await expect(
        service.generateAccessToken({
          userId: randomUUID(),
          workspaceId: randomUUID(),
          authProvider: AuthProviderEnum.Password,
        }),
      ).rejects.toThrow(
        'Native password authentication is disabled when GOTRUE_URL is configured',
      );

      expect(findOneSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateToken', () => {
    it('should validate a token successfully', async () => {
      const mockToken = 'valid-token';
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      } as Request;
      const mockDecodedToken = { sub: 'user-id', workspaceId: 'workspace-id' };
      const mockAuthContext = {
        user: { id: 'user-id' },
        apiKey: null,
        workspace: { id: 'workspace-id' },
        workspaceMemberId: 'workspace-member-id',
      };

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => mockToken);
      jest
        .spyOn(jwtWrapperService, 'verifyJwtToken')
        .mockResolvedValue(undefined);
      jest
        .spyOn(jwtWrapperService, 'decode')
        .mockReturnValue(mockDecodedToken as any);
      jest
        .spyOn(service['jwtStrategy'], 'validate')
        .mockReturnValue(mockAuthContext as any);

      const result = await service.validateTokenByRequest(mockRequest);

      expect(result).toEqual(mockAuthContext);
      expect(jwtWrapperService.verifyJwtToken).toHaveBeenCalledWith(mockToken);
      expect(jwtWrapperService.decode).toHaveBeenCalledWith(mockToken);
      expect(service['jwtStrategy'].validate).toHaveBeenCalledWith(
        mockDecodedToken,
      );
    });

    it('should throw an error if token is missing', async () => {
      const mockRequest = {
        headers: {},
      } as Request;

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => null);

      await expect(service.validateTokenByRequest(mockRequest)).rejects.toThrow(
        AuthException,
      );
    });

    it('falls back to GoTrue JWTs and auto-provisions workspace access', async () => {
      const gotrueUserId = randomUUID();
      const workspaceId = randomUUID();
      const userWorkspaceId = randomUUID();
      const workspaceMemberId = randomUUID();
      const email = 'gotrue@example.com';
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
      const token = jwt.sign(
        {
          sub: gotrueUserId,
          email,
          name: 'Go True',
        },
        privateKey,
        {
          algorithm: 'RS256',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: 'http://gotrue:9999/auth/v1',
          keyid: 'gtr-key-1',
        },
      );
      const mockRequest = {
        headers: {
          authorization: `Bearer ${token}`,
          origin: 'https://crm.example.com',
        },
        protocol: 'https',
      } as Request;
      const workspace = { id: workspaceId } as WorkspaceEntity;
      let storedUser: UserEntity | null = null;
      let hasMembership = false;

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => token);
      jest
        .spyOn(jwtWrapperService, 'verifyJwtToken')
        .mockRejectedValue(new Error('Token invalid'));
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL: 'http://gotrue:9999',
      });
      jest
        .spyOn(
          workspaceDomainsService,
          'getWorkspaceByOriginOrDefaultWorkspace',
        )
        .mockResolvedValue(workspace);
      jest
        .spyOn(userRepository, 'create')
        .mockImplementation((entity) => entity as UserEntity);
      jest
        .spyOn(userRepository, 'findOne')
        .mockImplementation(async (input) => {
          if (
            input?.where &&
            'id' in input.where &&
            input.where.id === gotrueUserId
          ) {
            return storedUser;
          }

          if (
            input?.where &&
            'email' in input.where &&
            input.where.email === email
          ) {
            return storedUser;
          }

          return null;
        });
      jest.spyOn(userRepository, 'save').mockImplementation(async (entity) => {
        storedUser = {
          firstName: 'Go',
          lastName: 'True',
          isEmailVerified: true,
          locale: 'en',
          ...entity,
        } as UserEntity;

        return storedUser;
      });
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockImplementation(async (input) => {
          const where = Array.isArray(input?.where)
            ? input?.where[0]
            : input?.where;

          if (
            hasMembership &&
            storedUser &&
            where?.userId === storedUser.id &&
            where?.workspaceId === workspaceId
          ) {
            return {
              id: userWorkspaceId,
              userId: storedUser.id,
              workspaceId,
            } as UserWorkspaceEntity;
          }

          return null;
        });
      jest
        .spyOn(userWorkspaceService, 'addUserToWorkspaceIfUserNotInWorkspace')
        .mockImplementation(async () => {
          hasMembership = true;
        });
      jest.spyOn(globalWorkspaceOrmManager, 'getRepository').mockResolvedValue({
        findOne: jest.fn().mockImplementation(async () => {
          if (!hasMembership || !storedUser) {
            return null;
          }

          return {
            id: workspaceMemberId,
            userId: storedUser.id,
          };
        }),
      } as any);
      jest
        .spyOn(coreEntityCacheService, 'invalidateAndRecompute')
        .mockResolvedValue(undefined);
      jest
        .spyOn(coreEntityCacheService, 'get')
        .mockImplementation(async (key) => {
          if (key === 'user') {
            return {
              id: storedUser?.id ?? gotrueUserId,
              email,
            } as any;
          }

          if (key === 'userWorkspaceEntity') {
            return {
              id: userWorkspaceId,
              userId: storedUser?.id ?? gotrueUserId,
              workspaceId,
            } as any;
          }

          if (key === 'workspaceEntity') {
            return {
              id: workspaceId,
            } as any;
          }

          return null;
        });
      jest
        .spyOn(workspaceCacheService, 'invalidateAndRecompute')
        .mockResolvedValue(undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'gtr-key-1', use: 'sig' }],
        }),
      } as Response) as typeof fetch;

      const result = await service.validateTokenByRequest(mockRequest);

      expect(result).toEqual(
        expect.objectContaining({
          authProvider: AuthProviderEnum.SSO,
          userWorkspaceId,
          workspaceMemberId,
        }),
      );
      expect(
        userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace,
      ).toHaveBeenCalledWith(expect.objectContaining({ email }), workspace);
      expect(workspaceCacheService.invalidateAndRecompute).toHaveBeenCalledWith(
        workspaceId,
        ['flatWorkspaceMemberMaps'],
      );
    });

    it('rejects GoTrue JWTs with an unexpected audience', async () => {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
      const token = jwt.sign(
        {
          sub: randomUUID(),
          email: 'gotrue@example.com',
        },
        privateKey,
        {
          algorithm: 'RS256',
          audience: 'wrong-audience',
          expiresIn: '1h',
          issuer: 'http://gotrue:9999/auth/v1',
          keyid: 'gtr-key-1',
        },
      );

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => token);
      jest
        .spyOn(jwtWrapperService, 'verifyJwtToken')
        .mockRejectedValue(new Error('Token invalid'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'gtr-key-1', use: 'sig' }],
        }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL: 'http://gotrue:9999',
      });

      await expect(
        service.validateTokenByRequest({
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'https://crm.example.com',
          },
          protocol: 'https',
        } as Request),
      ).rejects.toThrow('Token invalid');

      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).not.toHaveBeenCalled();
    });

    it('rejects GoTrue JWTs with an unexpected issuer', async () => {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
      const token = jwt.sign(
        {
          sub: randomUUID(),
          email: 'gotrue@example.com',
        },
        privateKey,
        {
          algorithm: 'RS256',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: 'https://attacker.example.com',
          keyid: 'gtr-key-1',
        },
      );

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => token);
      jest
        .spyOn(jwtWrapperService, 'verifyJwtToken')
        .mockRejectedValue(new Error('Token invalid'));
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'gtr-key-1', use: 'sig' }],
        }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL: 'http://gotrue:9999',
      });

      await expect(
        service.validateTokenByRequest({
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'https://crm.example.com',
          },
          protocol: 'https',
        } as Request),
      ).rejects.toThrow('Token invalid');

      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).not.toHaveBeenCalled();
    });
  });

  // ── bug 550d6ab7 ────────────────────────────────────────────────────────────
  // GoTrue deliberately filters HMAC keys out of /.well-known/jwks.json
  // (internal/api/jwks.go skips jwa.OctetSeq — publishing `k` would leak
  // GOTRUE_JWT_SECRET). A symmetric GoTrue therefore serves `{"keys":[]}`, and
  // the JWKS-only key lookup made GET /api/auth/gotrue-callback unsatisfiable:
  // no correctly-signed token could ever be accepted. These tests pin the
  // HS256 shared-secret fallback and, critically, that it cannot be abused to
  // downgrade an asymmetric deployment.
  describe('verifyGoTrueToken with a symmetric (HS256) GoTrue', () => {
    const GOTRUE_URL = 'http://gotrue:9999';
    const GOTRUE_ISSUER = 'http://gotrue:9999/auth/v1';
    const SHARED_SECRET = 'gotrue-shared-secret-value-do-not-log';
    const EMAIL = 'symmetric@example.com';

    const mockJwks = (keys: unknown[]) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys }),
      } as Response) as typeof fetch;
    };

    const signHs256 = (
      secret: string | Buffer,
      overrides: jwt.SignOptions = {},
    ) =>
      jwt.sign({ sub: randomUUID(), email: EMAIL }, secret, {
        algorithm: 'HS256',
        audience: 'authenticated',
        expiresIn: '1h',
        issuer: GOTRUE_ISSUER,
        ...overrides,
      });

    // Both callers of verifyGoTrueToken (tryValidateGoTrueToken and the
    // gotrue-callback controller) treat a throw and a null identically as
    // "rejected", so rejection is asserted uniformly as "yields no claims".
    const verifyOrNull = async (token: string) => {
      try {
        return await service.verifyGoTrueToken(token, GOTRUE_URL);
      } catch {
        return null;
      }
    };

    beforeEach(() => {
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });
      mockJwks([]);
    });

    it('accepts a valid HS256 token signed with the configured shared secret', async () => {
      const claims = await service.verifyGoTrueToken(
        signHs256(SHARED_SECRET),
        GOTRUE_URL,
      );

      expect(claims).toEqual(expect.objectContaining({ email: EMAIL }));
    });

    it('rejects an HS256 token signed with the wrong secret', async () => {
      expect(await verifyOrNull(signHs256('a-different-secret'))).toBeNull();
    });

    it('rejects an expired HS256 token', async () => {
      expect(
        await verifyOrNull(signHs256(SHARED_SECRET, { expiresIn: '-1h' })),
      ).toBeNull();
    });

    it('rejects an HS256 token from an unexpected issuer', async () => {
      expect(
        await verifyOrNull(
          signHs256(SHARED_SECRET, { issuer: 'https://attacker.example.com' }),
        ),
      ).toBeNull();
    });

    it('rejects an HS256 token with an unexpected audience', async () => {
      expect(
        await verifyOrNull(
          signHs256(SHARED_SECRET, { audience: 'wrong-audience' }),
        ),
      ).toBeNull();
    });

    it('rejects an HS256 token when GOTRUE_JWT_SECRET is not configured', async () => {
      mockConfig({ FRONTEND_URL: 'https://crm.example.com', GOTRUE_URL });

      expect(await verifyOrNull(signHs256(SHARED_SECRET))).toBeNull();
    });

    it('rejects an HS256 token when GOTRUE_JWT_SECRET is an empty string', async () => {
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: '',
      });

      expect(await verifyOrNull(signHs256(SHARED_SECRET))).toBeNull();
    });
  });

  describe('verifyGoTrueToken algorithm-confusion defence', () => {
    const GOTRUE_URL = 'http://gotrue:9999';
    const GOTRUE_ISSUER = 'http://gotrue:9999/auth/v1';
    const SHARED_SECRET = 'gotrue-shared-secret-value-do-not-log';
    const EMAIL = 'attacker@example.com';

    const verifyOrNull = async (token: string) => {
      try {
        return await service.verifyGoTrueToken(token, GOTRUE_URL);
      } catch {
        return null;
      }
    };

    // Classic downgrade: the deployment signs with RSA and publishes the public
    // key; the attacker re-signs as HS256 using the *public key bytes* as the
    // HMAC secret. Must be rejected — the public key is never an HMAC secret.
    // NOTE: the `kid` matches, so the JWKS lookup succeeds and this is caught by
    // jsonwebtoken's own key-type guard ("secretOrPublicKey must be a symmetric
    // key when using HS256") rather than by the new fallback. The test below,
    // with an unknown `kid`, is the one that exercises the fallback's own guard.
    it('rejects an HS256 token forged with the advertised RSA public key as the HMAC secret', async () => {
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
      const publicPem = publicKey.export({
        type: 'spki',
        format: 'pem',
      }) as string;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'gtr-key-1', use: 'sig' }],
        }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });

      const forged = jwt.sign({ sub: randomUUID(), email: EMAIL }, publicPem, {
        algorithm: 'HS256',
        audience: 'authenticated',
        expiresIn: '1h',
        issuer: GOTRUE_ISSUER,
        keyid: 'gtr-key-1',
      });

      expect(await verifyOrNull(forged)).toBeNull();
    });

    // Second downgrade shape: an unknown `kid` makes the JWKS lookup miss, so
    // the attacker tries to steer an asymmetric deployment onto the symmetric
    // fallback. The fallback inspects the advertised key SET, not just the
    // lookup result, so it refuses to fire.
    it('rejects an HS256 token with an unknown kid while JWKS advertises asymmetric keys', async () => {
      const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...publicJwk, alg: 'RS256', kid: 'gtr-key-1', use: 'sig' }],
        }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });

      // Correctly signed with the real shared secret — rejected purely because
      // this deployment is asymmetric.
      const token = jwt.sign(
        { sub: randomUUID(), email: EMAIL },
        SHARED_SECRET,
        {
          algorithm: 'HS256',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: GOTRUE_ISSUER,
          keyid: 'unknown-kid',
        },
      );

      expect(await verifyOrNull(token)).toBeNull();
    });

    it('rejects an unsigned alg:none token even when the shared secret is configured', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [] }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });

      const unsigned = jwt.sign({ sub: randomUUID(), email: EMAIL }, '', {
        algorithm: 'none',
        audience: 'authenticated',
        expiresIn: '1h',
        issuer: GOTRUE_ISSUER,
      });

      expect(await verifyOrNull(unsigned)).toBeNull();
    });

    // A malformed JWKS must not be read as "no keys advertised" — that would
    // let a broken/hijacked JWKS response masquerade as a symmetric deployment
    // and steer verification onto the shared-secret fallback.
    it('rejects an HS256 token when the JWKS response is malformed', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: 'not-an-array' }),
      } as unknown as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });

      const token = jwt.sign(
        { sub: randomUUID(), email: EMAIL },
        SHARED_SECRET,
        {
          algorithm: 'HS256',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: GOTRUE_ISSUER,
        },
      );

      expect(await verifyOrNull(token)).toBeNull();
    });

    it('rejects an HS512 token signed with the shared secret (fallback is HS256-only)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [] }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });

      const token = jwt.sign(
        { sub: randomUUID(), email: EMAIL },
        SHARED_SECRET,
        {
          algorithm: 'HS512',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: GOTRUE_ISSUER,
        },
      );

      expect(await verifyOrNull(token)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // P2 cdb4a918 — Central disable enforcement tests
  // ─────────────────────────────────────────────────────────────────────────
  describe('verifyGoTrueToken central disable enforcement (bug cdb4a918)', () => {
    const GOTRUE_URL = 'https://auth.example.com';
    const SHARED_SECRET = 'test-secret-for-hs256-only';
    const EMAIL = 'user@example.com';
    const USER_ID = '550e8400-e29b-41d4-a716-446655440000';

    const createValidToken = (userId = USER_ID) => {
      return jwt.sign(
        { sub: userId, email: EMAIL },
        SHARED_SECRET,
        {
          algorithm: 'HS256',
          audience: 'authenticated',
          expiresIn: '1h',
          issuer: 'https://auth.example.com',
        },
      );
    };

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [] }),
      } as Response) as typeof fetch;
      mockConfig({
        FRONTEND_URL: 'https://crm.example.com',
        GOTRUE_URL,
        GOTRUE_JWT_SECRET: SHARED_SECRET,
      });
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('rejects a token when the user is banned at GoTrue', async () => {
      // Mock GoTrue /auth/v1/user to return banned=true
      (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url && url.includes('/auth/v1/user')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ banned: true }),
          } as Response);
        }
        // Default JWKS response
        return Promise.resolve({
          ok: true,
          json: async () => ({ keys: [] }),
        } as Response);
      });

      const token = createValidToken();
      const result = await service.verifyGoTrueToken(token, GOTRUE_URL);

      expect(result).toBeNull();
    });

    it('accepts a token when the user is not banned at GoTrue', async () => {
      // Mock GoTrue /auth/v1/user to return banned=false
      (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url && url.includes('/auth/v1/user')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ banned: false }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ keys: [] }),
        } as Response);
      });

      const token = createValidToken();
      const result = await service.verifyGoTrueToken(token, GOTRUE_URL);

      expect(result).not.toBeNull();
      expect(result?.email).toBe(EMAIL);
      expect(result?.sub).toBe(USER_ID);
    });

    it('accepts a token when GoTrue user check fails (degraded/fail-open)', async () => {
      // Mock GoTrue /auth/v1/user to return 500 error
      (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url && url.includes('/auth/v1/user')) {
          return Promise.resolve({
            ok: false,
            status: 500,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ keys: [] }),
        } as Response);
      });

      const token = createValidToken();
      const result = await service.verifyGoTrueToken(token, GOTRUE_URL);

      // Should accept based on token validity (fail-open posture)
      expect(result).not.toBeNull();
      expect(result?.email).toBe(EMAIL);
    });

    it('caches the banned status for 60 seconds', async () => {
      let fetchCallCount = 0;

      (global.fetch as jest.Mock).mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url && url.includes('/auth/v1/user')) {
          fetchCallCount++;
          return Promise.resolve({
            ok: true,
            json: async () => ({ banned: true }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ keys: [] }),
        } as Response);
      });

      const token = createValidToken();

      // First call should fetch user status
      await service.verifyGoTrueToken(token, GOTRUE_URL);
      expect(fetchCallCount).toBe(1);

      // Second call within cache window should use cache
      await service.verifyGoTrueToken(token, GOTRUE_URL);
      expect(fetchCallCount).toBe(1); // No additional fetch
    });
  });
});
