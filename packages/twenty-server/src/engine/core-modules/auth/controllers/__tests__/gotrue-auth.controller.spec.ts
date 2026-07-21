import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { GoTrueAuthController } from '../gotrue-auth.controller';

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

const MOCK_LOGIN_TOKEN = {
  token: 'login-token-xyz',
  expiresAt: new Date(Date.now() + 900_000),
};

/* ------------------------------------------------------------------ */
/*  Test suite                                                        */
/* ------------------------------------------------------------------ */

describe('GoTrueAuthController', () => {
  let controller: GoTrueAuthController;
  let loginTokenService: LoginTokenService;
  let signInUpService: SignInUpService;
  let workspaceService: WorkspaceService;

  let userRepo: { findOne: jest.Mock };
  let userWorkspaceRepo: { findOne: jest.Mock };
  let workspaceRepo: { findOne: jest.Mock };
  // Tenant binding is resolved from the request origin via this service —
  // never from a global "first/oldest workspace" repository query.
  let workspaceDomainsService: {
    getWorkspaceByOriginOrDefaultWorkspace: jest.Mock;
  };
  // Boundary guard: a DataSource is still registered so that if anyone
  // re-introduces a raw-SQL injection into the controller, this spy will catch
  // any write to Wiki-owned tables (public.workspaces/users/workspace_users).
  let dataSource: { query: jest.Mock };

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  const buildTestModule = (overrideProviders?: any[]) =>
    Test.createTestingModule({
      controllers: [GoTrueAuthController],
      providers: [
        {
          provide: LoginTokenService,
          useValue: {
            generateLoginToken: jest.fn().mockResolvedValue(MOCK_LOGIN_TOKEN),
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
          provide: WorkspaceDomainsService,
          useValue: workspaceDomainsService,
        },
        {
          provide: DataSource,
          useValue: dataSource,
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
        ...(overrideProviders ?? []),
      ],
    }).compile();

  beforeEach(async () => {
    // Set env vars the controller reads in its constructor
    process.env.GOTRUE_URL = 'http://gotrue:9999';
    process.env.EXE_CRM_ADMIN_TOKEN = 'admin-secret-123';
    process.env.SERVER_URL = 'http://localhost:3000';

    userRepo = { findOne: jest.fn() };
    userWorkspaceRepo = { findOne: jest.fn() };
    workspaceRepo = { findOne: jest.fn() };
    // Default: a single resolvable tenant. Individual tests override the
    // return value to exercise multi-tenant / unresolvable cases.
    workspaceDomainsService = {
      getWorkspaceByOriginOrDefaultWorkspace: jest
        .fn()
        .mockResolvedValue(MOCK_WORKSPACE),
    };
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await buildTestModule();

    controller = module.get(GoTrueAuthController);
    loginTokenService = module.get(LoginTokenService);
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

      const module: TestingModule = await buildTestModule();
      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.gotrueLogin({ email: 'a@b.com', password: 'pass' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
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
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const res = mockResponse();

      await controller.gotrueLogin({ email: 'a@b.com', password: 'pass' }, res);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('binds an existing user to the origin-resolved tenant and returns redirectUrl', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: MOCK_USER.email },
          }),
      });

      userRepo.findOne.mockResolvedValue(MOCK_USER);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'correct-pass' },
        res,
      );

      // Tenant came from origin resolution, not a first/oldest workspace query.
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: expect.stringContaining('/verify?loginToken='),
        }),
      );
      expect(res.status).not.toHaveBeenCalled();
    });

    it('denies an existing user who is not a member of the resolved tenant (403)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: MOCK_USER.email },
          }),
      });

      userRepo.findOne.mockResolvedValue(MOCK_USER);
      // Resolved a tenant, but the user has no membership in it.
      userWorkspaceRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'correct-pass' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
    });

    it('returns 400 for an existing user when no tenant can be resolved', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: MOCK_USER.email },
          }),
      });

      userRepo.findOne.mockResolvedValue(MOCK_USER);
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        null,
      );

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'correct-pass' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
    });

    it('auto-provisions workspace+user when user does not exist', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'gotrue-at',
            user: { id: 'gotrue-uid', email: 'new@exe.ai' },
          }),
      });

      // First call (existence check): no user. After provisioning: user exists.
      let callCount = 0;

      userRepo.findOne.mockImplementation(() => {
        callCount++;

        return callCount <= 1
          ? Promise.resolve(null)
          : Promise.resolve({ ...MOCK_USER, email: 'new@exe.ai' });
      });

      // Post-provision context is bound to the user's own new membership.
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);
      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);

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

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: expect.stringContaining('/verify?loginToken='),
        }),
      );

      // Boundary: CRM must NOT write Wiki-owned public tables during
      // provisioning. The Wiki provisions its own user on first Wiki login.
      const wikiWrites = dataSource.query.mock.calls.filter(([sql]) =>
        /public\.(workspaces|users|workspace_users)/i.test(String(sql)),
      );

      expect(wikiWrites).toHaveLength(0);
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

      // Origin resolution returns the pending tenant for the existing user.
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        pendingWorkspace,
      );
      workspaceRepo.findOne.mockResolvedValue(MOCK_WORKSPACE);
      userRepo.findOne.mockResolvedValue(MOCK_USER);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueLogin(
        { email: MOCK_USER.email, password: 'pass' },
        res,
      );

      expect(workspaceService.activateWorkspace).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: expect.stringContaining('/verify?loginToken='),
        }),
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

      const module: TestingModule = await buildTestModule();
      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.adminTokenLogin({ token: 'anything' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
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

    it('rate limits repeated failed admin token login attempts', async () => {
      for (let requestIndex = 0; requestIndex < 10; requestIndex++) {
        const res = mockResponse();

        await controller.adminTokenLogin({ token: 'wrong-token' }, res);

        expect(res.status).toHaveBeenCalledWith(401);
      }

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'wrong-token' }, res);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many requests - try again later.',
      });
    });

    it('does not rate limit repeated successful admin token logins', async () => {
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        MOCK_WORKSPACE,
      );
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);
      userRepo.findOne.mockResolvedValue(MOCK_USER);

      for (let requestIndex = 0; requestIndex < 12; requestIndex++) {
        const res = mockResponse();

        await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

        expect(res.status).not.toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            redirectUrl: expect.stringContaining('/verify?loginToken='),
            isAdminToken: true,
          }),
        );
      }
    });

    it('accepts a valid admin token after failed login attempts are limited', async () => {
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        MOCK_WORKSPACE,
      );
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);
      userRepo.findOne.mockResolvedValue(MOCK_USER);

      for (let requestIndex = 0; requestIndex < 10; requestIndex++) {
        await controller.adminTokenLogin(
          { token: 'wrong-token' },
          mockResponse(),
        );
      }

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).not.toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: expect.stringContaining('/verify?loginToken='),
          isAdminToken: true,
        }),
      );
    });

    it('returns 500 if no tenant can be resolved', async () => {
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        null,
      );

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns 500 if no user in the resolved tenant', async () => {
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        MOCK_WORKSPACE,
      );
      userWorkspaceRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('binds admin token to the origin-resolved tenant and returns redirectUrl', async () => {
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace.mockResolvedValue(
        MOCK_WORKSPACE,
      );
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);
      userRepo.findOne.mockResolvedValue(MOCK_USER);

      const res = mockResponse();

      await controller.adminTokenLogin({ token: 'admin-secret-123' }, res);

      // Tenant came from origin resolution, not a first/oldest workspace query.
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: expect.stringContaining('/verify?loginToken='),
          user: expect.objectContaining({ id: MOCK_USER.id }),
          isAdminToken: true,
        }),
      );
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
