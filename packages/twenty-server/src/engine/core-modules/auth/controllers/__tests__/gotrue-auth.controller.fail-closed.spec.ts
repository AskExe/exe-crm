import { Logger } from '@nestjs/common';

import { GoTrueAuthController } from 'src/engine/core-modules/auth/controllers/gotrue-auth.controller';
import { EXE_PERMS_ENFORCEMENT_DISABLED_WARNING } from 'src/engine/core-modules/auth/services/exe-perms.util';

/**
 * End-to-end assertions for the FAIL-CLOSED contract on the GoTrue password
 * login path (unified-permissions §2).
 *
 * REGRESSION: a PRESENT `exe_perms` claim that cannot be bound to the
 * configured `EXE_ORG_ID` previously resolved to `{ managed: false }`, which
 * routed the caller into NATIVE upstream provisioning with full default access.
 * It must now hit the managed-deny 403, matching exe-wiki and exe-erp.
 *
 * These tests deliberately exercise a NON-privileged outcome: proving an admin
 * can log in says nothing about whether an unauthorized identity is stopped.
 */

const ORG_ID = 'org-acme';
const EMAIL = 'user@example.com';

const encodeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return `${header}.${body}.signature`;
};

const mockRes = () => {
  const res: any = {};

  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);

  return res;
};

const deps = () => {
  const signInUpService = {
    signInUpOnExistingWorkspace: jest.fn().mockResolvedValue(undefined),
    signUpOnNewWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const loginTokenService = {
    generateLoginToken: jest.fn().mockResolvedValue({ token: 'login-token' }),
  };
  const roleSyncService = {
    applyCrmTier: jest.fn().mockResolvedValue({ status: 'applied' }),
    resolveAssignableRoleId: jest.fn().mockResolvedValue('role-managed'),
  };

  return {
    accessTokenService: {
      verifyGoTrueToken: jest.fn(),
      verifyGoTrueTokenDetailed: jest.fn(),
      describeGoTrueSigning: jest.fn().mockResolvedValue('symmetric'),
    },
    loginTokenService,
    signInUpService,
    workspaceService: { activateWorkspace: jest.fn() },
    workspaceDomainsService: {
      getWorkspaceByOriginOrDefaultWorkspace: jest
        .fn()
        .mockResolvedValue({ id: 'ws-native', defaultRoleId: 'role-default' }),
    },
    roleSyncService,
    userRepository: {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', email: EMAIL }),
    },
    userWorkspaceRepository: {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'uw-1', userId: 'user-1', workspaceId: 'ws' }),
    },
    workspaceRepository: {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'ws-canonical', defaultRoleId: 'role-def' }),
    },
  };
};

const buildController = (orgId: string | undefined) => {
  if (orgId === undefined) {
    delete process.env.EXE_ORG_ID;
  } else {
    process.env.EXE_ORG_ID = orgId;
  }
  process.env.GOTRUE_URL = 'http://gotrue:9999';
  process.env.EXE_ORG_WORKSPACE_ID = 'ws-canonical';
  process.env.SERVER_URL = 'https://crm.example.com';

  const d = deps();
  const controller = new GoTrueAuthController(
    d.accessTokenService as any,
    d.loginTokenService as any,
    d.signInUpService as any,
    d.workspaceService as any,
    d.workspaceDomainsService as any,
    d.roleSyncService as any,
    d.userRepository as any,
    d.userWorkspaceRepository as any,
    d.workspaceRepository as any,
  );

  return { controller, ...d };
};

/** GoTrue accepted the password; the token carries `appMetadata`. */
const mockGoTrueOk = (appMetadata: Record<string, unknown>) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        access_token: encodeJwt({
          sub: 'gotrue-uid',
          app_metadata: appMetadata,
        }),
      }),
  }) as unknown as typeof global.fetch;
};

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('gotrueLogin — managed-deny when the claim cannot bind to EXE_ORG_ID Fail', () => {
  it.each<{ label: string; exePerms: unknown }>([
    {
      label: 'per-org claim naming a DIFFERENT org',
      exePerms: { version: 1, orgs: { 'org-other': { caps: ['crm:admin'] } } },
    },
    {
      label: 'flat claim scoped to a DIFFERENT org',
      exePerms: { org: 'org-other', role: 'admin', caps: ['crm:admin'] },
    },
    {
      label: 'UNSCOPED flat claim naming no org',
      exePerms: { role: 'admin', caps: ['crm:admin'] },
    },
    { label: 'malformed scalar claim', exePerms: 'admin' },
    { label: 'null claim', exePerms: null },
  ])('denies with 403 for $label', async ({ exePerms }) => {
    const { controller, loginTokenService, signInUpService, roleSyncService } =
      buildController(ORG_ID);

    mockGoTrueOk({ exe_perms: exePerms });

    const res = mockRes();

    await controller.gotrueLogin({ email: EMAIL, password: 'pw' }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    // Fail closed means: no session, no provisioning, no role application.
    expect(loginTokenService.generateLoginToken).not.toHaveBeenCalled();
    expect(signInUpService.signUpOnNewWorkspace).not.toHaveBeenCalled();
    expect(signInUpService.signInUpOnExistingWorkspace).not.toHaveBeenCalled();
    expect(roleSyncService.applyCrmTier).not.toHaveBeenCalled();
  });
});

describe('gotrueLogin — behavior deliberately preserved', () => {
  it('still grants a managed session at the right tier when the claim names THIS org', async () => {
    const { controller, loginTokenService, roleSyncService } =
      buildController(ORG_ID);

    mockGoTrueOk({
      exe_perms: {
        version: 1,
        orgs: { [ORG_ID]: { role: 'member', caps: ['crm:write'] } },
      },
    });

    const res = mockRes();

    await controller.gotrueLogin({ email: EMAIL, password: 'pw' }, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(loginTokenService.generateLoginToken).toHaveBeenCalled();
    expect(roleSyncService.applyCrmTier).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'write' }),
    );
  });

  it('stays on the native path when the identity carries NO exe_perms claim', async () => {
    const { controller, roleSyncService } = buildController(ORG_ID);

    mockGoTrueOk({ provider: 'email' });

    const res = mockRes();

    await controller.gotrueLogin({ email: EMAIL, password: 'pw' }, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    // Unmanaged: enforcement never runs.
    expect(roleSyncService.applyCrmTier).not.toHaveBeenCalled();
  });

  it('stays unmanaged when EXE_ORG_ID is unset, even with a claim present', async () => {
    const { controller, roleSyncService } = buildController(undefined);

    mockGoTrueOk({
      exe_perms: { orgs: { 'org-other': { caps: ['crm:admin'] } } },
    });

    const res = mockRes();

    await controller.gotrueLogin({ email: EMAIL, password: 'pw' }, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(roleSyncService.applyCrmTier).not.toHaveBeenCalled();
  });
});

describe('enforcement-disabled startup warning', () => {
  it('warns loudly at construction when EXE_ORG_ID is unset', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    buildController(undefined);

    expect(warn).toHaveBeenCalledWith(EXE_PERMS_ENFORCEMENT_DISABLED_WARNING);
  });

  it('does not warn when EXE_ORG_ID is configured', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    buildController(ORG_ID);

    expect(warn).not.toHaveBeenCalledWith(
      EXE_PERMS_ENFORCEMENT_DISABLED_WARNING,
    );
  });
});
