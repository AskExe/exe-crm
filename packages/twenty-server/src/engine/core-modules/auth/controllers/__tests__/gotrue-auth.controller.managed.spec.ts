import { GoTrueAuthController } from 'src/engine/core-modules/auth/controllers/gotrue-auth.controller';

/**
 * Focused unit tests for the MANAGED login decision surface of
 * GoTrueAuthController (unified-permissions §2). We exercise the private
 * `handleManagedLogin` directly — it is the whole response path for a managed
 * login — to assert the two security invariants:
 *
 *  - Fix #2: caps are applied to the CANONICAL workspace bound via
 *    EXE_ORG_WORKSPACE_ID. A managed user is NEVER routed through
 *    new-workspace provisioning (which would make them Admin/owner).
 *  - Fix #1: a non-admin user is never issued a session while holding an Admin
 *    role their caps don't grant (fail closed on the last-admin guard).
 */

const ORG_ID = 'org-1';
const CANONICAL_WS_ID = 'ws-canonical';
const DEFAULT_ROLE_ID = 'role-member';
const USER_ID = 'user-1';
const USER_WORKSPACE_ID = 'uw-1';
const EMAIL = 'managed@example.com';

const makeRes = () => {
  const res: any = {};

  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);

  return res;
};

const buildController = (
  env: Record<string, string | undefined>,
  overrides: {
    workspace?: unknown;
    existingUserWorkspace?: unknown;
    applyResult?: { status: string };
  } = {},
) => {
  const prev = { ...process.env };

  process.env.EXE_ORG_ID = env.EXE_ORG_ID;
  process.env.EXE_ORG_WORKSPACE_ID = env.EXE_ORG_WORKSPACE_ID;
  process.env.SERVER_URL = 'https://crm.example.com';

  const workspace =
    'workspace' in overrides
      ? overrides.workspace
      : { id: CANONICAL_WS_ID, defaultRoleId: DEFAULT_ROLE_ID };

  const loginTokenService = {
    generateLoginToken: jest.fn().mockResolvedValue({ token: 'login-token' }),
  };
  const signInUpService = {
    signInUpOnExistingWorkspace: jest.fn().mockResolvedValue(undefined),
    signUpOnNewWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const workspaceService = { activateWorkspace: jest.fn() };
  const workspaceDomainsService = {
    getWorkspaceByOriginOrDefaultWorkspace: jest.fn(),
  };
  const roleSyncService = {
    applyCrmTier: jest
      .fn()
      .mockResolvedValue(overrides.applyResult ?? { status: 'applied' }),
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue({ id: USER_ID, email: EMAIL }),
  };
  const userWorkspaceRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        'existingUserWorkspace' in overrides
          ? overrides.existingUserWorkspace
          : { id: USER_WORKSPACE_ID, userId: USER_ID, workspaceId: CANONICAL_WS_ID },
      ),
  };
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue(workspace),
  };

  const controller = new GoTrueAuthController(
    loginTokenService as any,
    signInUpService as any,
    workspaceService as any,
    workspaceDomainsService as any,
    roleSyncService as any,
    userRepository as any,
    userWorkspaceRepository as any,
    workspaceRepository as any,
  );

  process.env = prev;

  return {
    controller,
    loginTokenService,
    signInUpService,
    roleSyncService,
    userRepository,
    userWorkspaceRepository,
    workspaceRepository,
  };
};

const callManaged = (controller: GoTrueAuthController, res: any, tier: string, existingUser: unknown = { id: USER_ID, email: EMAIL }) =>
  (controller as any).handleManagedLogin(res, EMAIL, existingUser, tier);

describe('GoTrueAuthController.handleManagedLogin — canonical workspace binding (Fix #2)', () => {
  it('applies caps to the canonical workspace and mints a token for an existing member', async () => {
    const { controller, roleSyncService, loginTokenService, signInUpService } =
      buildController({ EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID });
    const res = makeRes();

    await callManaged(controller, res, 'write');

    expect(roleSyncService.applyCrmTier).toHaveBeenCalledWith({
      userWorkspaceId: USER_WORKSPACE_ID,
      workspaceId: CANONICAL_WS_ID,
      tier: 'write',
    });
    expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      EMAIL,
      CANONICAL_WS_ID,
      expect.anything(),
    );
    expect(res.json).toHaveBeenCalledWith({
      redirectUrl: expect.stringContaining('/verify?loginToken='),
    });
  });

  it('provisions a NON-member into the canonical workspace with the default (non-admin) role — never a new workspace', async () => {
    const { controller, signInUpService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      { existingUserWorkspace: null },
    );
    const res = makeRes();

    // No membership on first lookup, then present after provisioning.
    (controller as any).userWorkspaceRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: USER_WORKSPACE_ID,
        userId: USER_ID,
        workspaceId: CANONICAL_WS_ID,
      });

    await callManaged(controller, res, 'read', null);

    expect(signInUpService.signInUpOnExistingWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: expect.objectContaining({ id: CANONICAL_WS_ID }),
        roleId: DEFAULT_ROLE_ID,
      }),
    );
    expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      redirectUrl: expect.stringContaining('/verify'),
    });
  });
});

describe('GoTrueAuthController.handleManagedLogin — fail closed Fail', () => {
  it('fails closed (500) when EXE_ORG_WORKSPACE_ID is unset', async () => {
    const { controller, loginTokenService } = buildController({
      EXE_ORG_ID: ORG_ID,
      EXE_ORG_WORKSPACE_ID: undefined,
    });
    const res = makeRes();

    await callManaged(controller, res, 'write');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
  });

  it('fails closed (500) when the canonical workspace does not exist', async () => {
    const { controller, loginTokenService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      { workspace: null },
    );
    const res = makeRes();

    await callManaged(controller, res, 'write');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
  });

  it('fails closed (403) when a non-member cannot join the canonical workspace', async () => {
    const { controller, signInUpService, loginTokenService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      { existingUserWorkspace: null },
    );
    const res = makeRes();

    (controller as any).userWorkspaceRepository.findOne.mockResolvedValue(null);
    signInUpService.signInUpOnExistingWorkspace.mockRejectedValue(
      new Error('workspace not ready'),
    );

    await callManaged(controller, res, 'read', null);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
  });
});

describe('GoTrueAuthController.handleManagedLogin — non-admin never keeps Admin (Fix #1) Fail', () => {
  it('DENIES a non-admin login when demotion is blocked by the last-admin guard', async () => {
    const { controller, loginTokenService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      { applyResult: { status: 'blocked_last_admin' } },
    );
    const res = makeRes();

    await callManaged(controller, res, 'read');

    expect(res.status).toHaveBeenCalledWith(403);
    // Critical: no session is minted for a user holding a role their caps
    // don't grant.
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
  });

  it('DENIES a crm:write user blocked from demotion too', async () => {
    const { controller, loginTokenService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      { applyResult: { status: 'blocked_last_admin' } },
    );
    const res = makeRes();

    await callManaged(controller, res, 'write');

    expect(res.status).toHaveBeenCalledWith(403);
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
  });

  it('ALLOWS an admin-tier login (admin is legitimately entitled to Admin)', async () => {
    const { controller, loginTokenService } = buildController(
      { EXE_ORG_ID: ORG_ID, EXE_ORG_WORKSPACE_ID: CANONICAL_WS_ID },
      // Assigning admin never triggers the last-admin guard, but even a noop
      // result must still mint the session.
      { applyResult: { status: 'noop' } },
    );
    const res = makeRes();

    await callManaged(controller, res, 'admin');

    expect(loginTokenService.generateLoginToken).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      redirectUrl: expect.stringContaining('/verify'),
    });
  });
});
