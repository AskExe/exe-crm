import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { type Request } from 'express';
import { DataSource } from 'typeorm';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { RoleSyncService } from 'src/engine/core-modules/auth/services/role-sync.service';
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
  res.redirect = jest.fn().mockReturnValue(res);
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
  let accessTokenService: AccessTokenService;
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
          provide: AccessTokenService,
          useValue: {
            verifyGoTrueToken: jest.fn(),
          },
        },
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
          // Unmanaged path (EXE_ORG_ID unset) never invokes role sync, but the
          // controller declares it as a constructor dependency.
          provide: RoleSyncService,
          useValue: {
            applyCrmTier: jest.fn().mockResolvedValue({ status: 'noop' }),
          },
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
    // Enable the break-glass admin-token path for the default (enabled) suite;
    // individual tests override this to exercise the disabled/managed gates.
    process.env.ENABLE_ADMIN_TOKEN_LOGIN = 'true';
    delete process.env.EXE_ORG_ID;
    // Managed-required is the DEFAULT (e51ca54c §10.6b). Tests that exercise the
    // self-hosted bootstrap path opt out explicitly.
    delete process.env.CRM_REQUIRE_MANAGED_PERMS;

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
    accessTokenService = module.get(AccessTokenService);
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

    it('auto-provisions workspace+user when user does not exist (bootstrap opt-out)', async () => {
      // Self-hosted bootstrap: the operator explicitly disabled the
      // managed-required gate, so first-login provisioning is allowed.
      process.env.CRM_REQUIRE_MANAGED_PERMS = 'false';
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

    // ── E18 (e51ca54c §12) — the acceptance criterion for §10.6b ────────────
    it.each([
      { label: 'without a workspace name', workspaceName: undefined },
      {
        label: 'even when a workspace name is supplied',
        workspaceName: 'Mine',
      },
    ])(
      'denies an unmanaged first login by default $label — no workspace, no AdminFail',
      async ({ workspaceName }) => {
        // EXE_ORG_ID unset (deleted in beforeEach) + no exe_perms in the token
        // + no local user = the escalation shape. Nothing may be created.
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
          { email: 'new@exe.ai', password: 'pass', workspaceName },
          res,
        );

        // No workspace created, no membership, no Admin role, no session.
        expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
        expect(workspaceService.activateWorkspace).not.toHaveBeenCalled();
        expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
        // ...and the user is told what to do rather than being left guessing.
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringMatching(/administrator/i),
          }),
        );
        expect(res.json).not.toHaveBeenCalledWith(
          expect.objectContaining({ needsSetup: true }),
        );
      },
    );

    it('denies an unmanaged first login on the SSO-callback lane too (no workspace created)', async () => {
      jest.mocked(accessTokenService.verifyGoTrueToken).mockResolvedValue({
        sub: 'gotrue-user-id',
        email: 'new@exe.ai',
      });
      userRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.gotrueCallback(res, {
        headers: { cookie: 'exe_sess=verified.jwt' },
      } as unknown as Request);

      expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
      expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/welcome?ssoError=not_provisioned',
      );
    });

    it('returns needsSetup when first login without workspaceName (bootstrap opt-out)', async () => {
      // Only reachable when the managed-required gate is opted out; with the
      // default gate on we refuse before prompting for a workspace name.
      process.env.CRM_REQUIRE_MANAGED_PERMS = 'false';
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
  /*  GET /api/auth/gotrue-callback                                  */
  /* ================================================================ */

  describe('gotrueCallback', () => {
    it('redirects to normal login when exe_sess is missing', async () => {
      const res = mockResponse();

      await controller.gotrueCallback(res, {
        headers: {},
      } as unknown as Request);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/welcome?ssoError=no_session',
      );
      expect(accessTokenService.verifyGoTrueToken).not.toHaveBeenCalled();
    });

    it('redirects to normal login when the GoTrue cookie cannot be verified', async () => {
      jest
        .mocked(accessTokenService.verifyGoTrueToken)
        .mockRejectedValue(new Error('invalid token'));

      const res = mockResponse();

      await controller.gotrueCallback(res, {
        headers: { cookie: 'exe_sess=bad.jwt' },
      } as unknown as Request);

      expect(accessTokenService.verifyGoTrueToken).toHaveBeenCalledWith(
        'bad.jwt',
        'http://gotrue:9999',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/welcome?ssoError=token_unverifiable',
      );
      expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
    });

    it('verifies exe_sess, binds an existing user to the resolved tenant, and redirects to /verify', async () => {
      jest.mocked(accessTokenService.verifyGoTrueToken).mockResolvedValue({
        sub: 'gotrue-user-id',
        email: MOCK_USER.email,
      });
      userRepo.findOne.mockResolvedValue(MOCK_USER);
      userWorkspaceRepo.findOne.mockResolvedValue(MOCK_USER_WORKSPACE);

      const res = mockResponse();

      await controller.gotrueCallback(res, {
        headers: {
          cookie: 'theme=light; exe_sess=verified.jwt; exe_access_token=1',
          origin: 'http://localhost:3000',
        },
      } as unknown as Request);

      expect(accessTokenService.verifyGoTrueToken).toHaveBeenCalledWith(
        'verified.jwt',
        'http://gotrue:9999',
      );
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/verify?loginToken='),
      );
    });

    it('does not provision a first-login callback without workspace setup', async () => {
      jest.mocked(accessTokenService.verifyGoTrueToken).mockResolvedValue({
        sub: 'gotrue-user-id',
        email: 'new@exe.ai',
      });
      userRepo.findOne.mockResolvedValue(null);

      const res = mockResponse();

      await controller.gotrueCallback(res, {
        headers: { cookie: 'exe_sess=verified.jwt' },
      } as unknown as Request);

      expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
      expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/welcome?ssoError=not_provisioned',
      );
    });

    /* -------------------------------------------------------------- */
    /*  Why the bridge gave up (bugs 2e2b5225 / 90bcd5ef)             */
    /*                                                                */
    /*  Every arm below used to emit the SAME bare redirect to        */
    /*  sign-in, so a server with no verification key, an identity    */
    /*  with no permissions, and a plain logged-out visitor were      */
    /*  indistinguishable from outside. That is what made the broken  */
    /*  demo login unexplainable without a five-fault investigation.  */
    /* -------------------------------------------------------------- */
    describe('failure reason', () => {
      it('reports token_unverifiable when verification yields no claims', async () => {
        // This is the shape of a missing GOTRUE_JWT_SECRET: GoTrue signs
        // HS256 and publishes no HMAC key, so verifyGoTrueToken RESOLVES
        // null — it does not throw. That must not be reported as a bad token.
        jest
          .mocked(accessTokenService.verifyGoTrueToken)
          .mockResolvedValue(null);

        const res = mockResponse();

        await controller.gotrueCallback(res, {
          headers: { cookie: 'exe_sess=well.formed.jwt' },
        } as unknown as Request);

        expect(res.redirect).toHaveBeenCalledWith(
          'http://localhost:3000/welcome?ssoError=token_unverifiable',
        );
        expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
      });

      it('reports invalid_claims when the session verifies but carries no identity', async () => {
        jest.mocked(accessTokenService.verifyGoTrueToken).mockResolvedValue({
          sub: 'gotrue-user-id',
        } as never);

        const res = mockResponse();

        await controller.gotrueCallback(res, {
          headers: { cookie: 'exe_sess=verified.jwt' },
        } as unknown as Request);

        expect(res.redirect).toHaveBeenCalledWith(
          'http://localhost:3000/welcome?ssoError=invalid_claims',
        );
      });

      it('reports no_crm_access when a managed org grants the identity no tier', async () => {
        process.env.EXE_ORG_ID = 'org-1';

        const module = await buildTestModule();
        const scopedController = module.get(GoTrueAuthController);
        const scopedAccessTokenService = module.get(AccessTokenService);

        // A real GoTrue JWT whose app_metadata carries an exe_perms entry for
        // this org with no CRM grant — exactly e2e@askexe.com's shape.
        const payload = Buffer.from(
          JSON.stringify({
            sub: 'gotrue-user-id',
            email: 'e2e@askexe.com',
            app_metadata: { exe_perms: { 'org-1': {} } },
          }),
        ).toString('base64url');
        const token = `${Buffer.from(
          JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
        ).toString('base64url')}.${payload}.sig`;

        jest
          .mocked(scopedAccessTokenService.verifyGoTrueToken)
          .mockResolvedValue({
            sub: 'gotrue-user-id',
            email: 'e2e@askexe.com',
          });

        const res = mockResponse();

        await scopedController.gotrueCallback(res, {
          headers: { cookie: `exe_sess=${token}` },
        } as unknown as Request);

        expect(res.redirect).toHaveBeenCalledWith(
          'http://localhost:3000/welcome?ssoError=no_crm_access',
        );
        expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
      });
    });
  });

  /* ================================================================ */
  /*  POST /api/auth/admin-token                                      */
  /* ================================================================ */

  describe('adminTokenLogin', () => {
    it('returns 401 with the correct admin token when the feature is disabled', async () => {
      delete process.env.ENABLE_ADMIN_TOKEN_LOGIN;

      const module: TestingModule = await buildTestModule();
      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      // Fails closed before touching tenant resolution.
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).not.toHaveBeenCalled();
    });

    it('returns 401 with the correct admin token in a managed deployment', async () => {
      process.env.EXE_ORG_ID = 'org-managed';

      const module: TestingModule = await buildTestModule();
      const ctrl = module.get(GoTrueAuthController);
      const res = mockResponse();

      await ctrl.adminTokenLogin({ token: 'admin-secret-123' }, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).not.toHaveBeenCalled();
    });

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

    it('pins the admin token to EXE_ORG_WORKSPACE_ID and IGNORES the client Host when managed', async () => {
      // Managed deployment: the canonical workspace must win over any
      // Host-derived tenant, closing the static-token cross-tenant takeover.
      process.env.EXE_ORG_WORKSPACE_ID = 'ws-canonical';

      const module: TestingModule = await buildTestModule();
      const ctrl = module.get(GoTrueAuthController);

      workspaceRepo.findOne.mockResolvedValue({
        ...MOCK_WORKSPACE,
        id: 'ws-canonical',
      });
      userWorkspaceRepo.findOne.mockResolvedValue({
        ...MOCK_USER_WORKSPACE,
        workspaceId: 'ws-canonical',
      });
      userRepo.findOne.mockResolvedValue(MOCK_USER);

      const res = mockResponse();

      await ctrl.adminTokenLogin({ token: 'admin-secret-123' }, res);

      // The mutable, client-controlled Host path is NOT consulted.
      expect(
        workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
      ).not.toHaveBeenCalled();
      expect(workspaceRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ws-canonical' },
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ isAdminToken: true }),
      );
    });
  });

  /* ================================================================ */
  /*  Boot-time SSO bridge readiness (bug 2e2b5225)                   */
  /*                                                                  */
  /*  A CRM that knows GOTRUE_URL but not GOTRUE_JWT_SECRET rejects   */
  /*  every genuine apex session and looks, from outside, exactly     */
  /*  like a logged-out user. A misconfiguration that fails closed    */
  /*  still has to be loud.                                           */
  /* ================================================================ */
  describe('GoTrue bridge readiness announcement', () => {
    it('logs an error at boot when GOTRUE_URL is set without GOTRUE_JWT_SECRET', async () => {
      delete process.env.GOTRUE_JWT_SECRET;

      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await buildTestModule();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('GOTRUE_JWT_SECRET'),
      );
    });

    it('does not log an error at boot once GOTRUE_JWT_SECRET is configured', async () => {
      process.env.GOTRUE_JWT_SECRET = 'shared-secret';

      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await buildTestModule();

      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('GOTRUE_JWT_SECRET'),
      );
    });

    it('says nothing when this deployment has no GoTrue at all', async () => {
      delete process.env.GOTRUE_URL;
      delete process.env.GOTRUE_JWT_SECRET;

      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await buildTestModule();

      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('GOTRUE_JWT_SECRET'),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('GOTRUE_JWT_SECRET'),
      );
    });
  });
});
