import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { RefreshTokenService } from 'src/engine/core-modules/auth/token/services/refresh-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { GoTrueAuthController } from '../gotrue-auth.controller';

// bcrypt.hash uses setTimeout internally which deadlocks with Jest fake timers
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockedhash'),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const mockResponse = () => {
  const res: any = {};

  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const MOCK_USER = {
  id: 'user-uuid-1',
  email: 'test@exe.ai',
};

const MOCK_WORKSPACE = {
  id: 'ws-uuid-1',
  displayName: 'Exe',
  activationStatus: WorkspaceActivationStatus.ACTIVE,
  createdAt: new Date(),
};

const MOCK_USER_WORKSPACE = {
  userId: MOCK_USER.id,
  workspaceId: MOCK_WORKSPACE.id,
  createdAt: new Date(),
};

const MOCK_ACCESS_TOKEN = {
  token: 'access-token-abc',
  expiresAt: new Date(Date.now() + 3600_000),
};

const MOCK_REFRESH_TOKEN = {
  token: 'refresh-token-xyz',
  expiresAt: new Date(Date.now() + 86400_000),
};

/* ------------------------------------------------------------------ */
/*  Test suite                                                        */
/* ------------------------------------------------------------------ */

describe('GoTrueAuthController', () => {
  let controller: GoTrueAuthController;
  let accessTokenService: AccessTokenService;
  let refreshTokenService: RefreshTokenService;
  let signInUpService: SignInUpService;
  let workspaceService: WorkspaceService;

  let userRepo: { findOne: jest.Mock };
  let userWorkspaceRepo: { findOne: jest.Mock };
  let workspaceRepo: { findOne: jest.Mock };

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Set env vars the controller reads in its constructor
    process.env.GOTRUE_URL = 'http://gotrue:9999';
    process.env.EXE_CRM_ADMIN_TOKEN = 'admin-secret-123';

    userRepo = { findOne: jest.fn() };
    userWorkspaceRepo = { findOne: jest.fn() };
    workspaceRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GoTrueAuthController],
      providers: [
        {
          provide: AccessTokenService,
          useValue: {
            generateAccessToken: jest
              .fn()
              .mockResolvedValue(MOCK_ACCESS_TOKEN),
          },
        },
        {
          provide: RefreshTokenService,
          useValue: {
            generateRefreshToken: jest
              .fn()
              .mockResolvedValue(MOCK_REFRESH_TOKEN),
          },
        },
        {
          provide: SignInUpService,
          useValue: {
            signUpOnNewWorkspace: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            activateWorkspace: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DataSource,
          useValue: {
            query: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepo,
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useValue: userWorkspaceRepo,
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: workspaceRepo,
        },
      ],
    }).compile();

    controller = module.get(GoTrueAuthController);
    accessTokenService = module.get(AccessTokenService);
    refreshTokenService = module.get(RefreshTokenService);
    signInUpService = module.get(SignInUpService);
    workspaceService = module.get(WorkspaceService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  /* ================================================================ */
  /*  POST /api/auth/gotrue-login                                     */
  /* ================================================================ */

  describe('gotrueLogin', () => {
    it('returns 400 if email is missing', async () => {
      const res = mockResponse();

      await controller.gotrueLogin({ password: 'pass123' }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 400 if password is missing', async () => {
      const res = mockResponse();

      await controller.gotrueLogin({ email: 'a@b.com' }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 500 if GOTRUE_URL is not configured', async () => {
      // Re-create controller without GOTRUE_URL
      delete process.env.GOTRUE_URL;
      delete process.env.EXE_GOTRUE_URL;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [GoTrueAuthController],
        providers: [
          { provide: AccessTokenService, useValue: { generateAccessToken: jest.fn() } },
          { provide: RefreshTokenService, useValue: { generateRefreshToken: jest.fn() } },
          { provide: SignInUpService, useValue: { signUpOnNewWorkspace: jest.fn() } },
          { provide: WorkspaceService, useValue: { activateWorkspace: jest.fn() } },
          { provide: DataSource, useValue: { query: jest.fn() } },
          { provide: getRepositoryToken(UserEntity), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(UserWorkspaceEntity), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(WorkspaceEntity), useValue: { findOne: jest.fn() } },
        ],
      }).compile();

      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.gotrueLogin({ email: 'a@b.com', password: 'pass' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('not configured') }),
      );
    });

    it('returns 401 if GoTrue rejects credentials', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({ error_description: 'Invalid login credentials' }),
      });

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: 'bad@exe.ai', password: 'wrong' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 502 if GoTrue is unreachable', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: 'a@b.com', password: 'pass' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('unavailable'),
        }),
      );
    });

    it('returns 200 with tokens and user on success (existing user)', async () => {
      // Mock GoTrue success
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: MOCK_USER.email },
          }),
      });

      // Mock existing user context
      userRepo.findOne.mockResolvedValue(MOCK_USER);
      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'correct-pass' },
        res,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.objectContaining({
            accessToken: expect.objectContaining({ token: MOCK_ACCESS_TOKEN.token }),
            refreshToken: expect.objectContaining({ token: MOCK_REFRESH_TOKEN.token }),
          }),
          user: expect.objectContaining({
            id: MOCK_USER.id,
            email: MOCK_USER.email,
          }),
        }),
      );
      // Should NOT have called res.status (direct res.json for 200)
      expect(res.status).not.toHaveBeenCalled();
    });

    it('auto-provisions workspace+user when user does not exist', async () => {
      // Mock GoTrue success
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: 'new@exe.ai' },
          }),
      });

      // First call: no user. After provisioning: user exists.
      let callCount = 0;

      userRepo.findOne.mockImplementation(() => {
        callCount++;

        return callCount <= 1
          ? Promise.resolve(null)
          : Promise.resolve({ ...MOCK_USER, email: 'new@exe.ai' });
      });

      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: 'new@exe.ai', password: 'pass', workspaceName: 'New Ws' },
        res,
      );

      expect(signInUpService.signUpOnNewWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newUserWithPicture',
          newUserWithPicture: expect.objectContaining({ email: 'new@exe.ai' }),
        }),
      );

      // Should still return tokens
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.any(Object),
          user: expect.any(Object),
        }),
      );
    });

    it('returns needsSetup when first login without workspaceName', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: 'new@exe.ai' },
          }),
      });

      userRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: 'new@exe.ai', password: 'pass' },
        res,
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ needsSetup: true }),
      );
    });

    it('activates workspace if still PENDING_CREATION', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: MOCK_USER.email },
          }),
      });

      const pendingWorkspace = {
        ...MOCK_WORKSPACE,
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      };

      // After activation, return active workspace
      let wsCallCount = 0;

      workspaceRepo.findOne.mockImplementation(() => {
        wsCallCount++;

        return wsCallCount <= 1
          ? Promise.resolve(pendingWorkspace)
          : Promise.resolve(MOCK_WORKSPACE);
      });

      userRepo.findOne.mockResolvedValue(MOCK_USER);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'pass' },
        res,
      );

      expect(workspaceService.activateWorkspace).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ tokens: expect.any(Object) }),
      );
    });
  });

  /* ================================================================ */
  /*  POST /api/auth/admin-token                                      */
  /* ================================================================ */

  describe('adminTokenLogin', () => {
    it('returns 400 if token is missing', async () => {
      const res = mockResponse();

      await controller.adminTokenLogin({}, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 500 if EXE_CRM_ADMIN_TOKEN is not configured', async () => {
      delete process.env.EXE_CRM_ADMIN_TOKEN;

      const module: TestingModule = await Test.createTestingModule({
        controllers: [GoTrueAuthController],
        providers: [
          { provide: AccessTokenService, useValue: { generateAccessToken: jest.fn() } },
          { provide: RefreshTokenService, useValue: { generateRefreshToken: jest.fn() } },
          { provide: SignInUpService, useValue: { signUpOnNewWorkspace: jest.fn() } },
          { provide: WorkspaceService, useValue: { activateWorkspace: jest.fn() } },
          { provide: DataSource, useValue: { query: jest.fn() } },
          { provide: getRepositoryToken(UserEntity), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(UserWorkspaceEntity), useValue: { findOne: jest.fn() } },
          { provide: getRepositoryToken(WorkspaceEntity), useValue: { findOne: jest.fn() } },
        ],
      }).compile();

      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.adminTokenLogin({ token: 'anything' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('not configured'),
        }),
      );
    });

    it('returns 401 if token does not match', async () => {
      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'wrong-token' }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 500 if no workspace exists', async () => {
      workspaceRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('No workspace'),
        }),
      );
    });

    it('returns 500 if no user in workspace', async () => {
      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);
      userWorkspaceRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('No user'),
        }),
      );
    });

    it('returns 200 with tokens, user, and isAdminToken on success', async () => {
      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: expect.objectContaining({
            accessToken: expect.objectContaining({
              token: MOCK_ACCESS_TOKEN.token,
            }),
            refreshToken: expect.objectContaining({
              token: MOCK_REFRESH_TOKEN.token,
            }),
          }),
          user: expect.objectContaining({ id: MOCK_USER.id }),
          isAdminToken: true,
        }),
      );
      // Direct res.json call, no res.status for 200
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
