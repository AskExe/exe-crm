import { Logger } from '@nestjs/common';

import { type NextFunction, type Request, type Response } from 'express';

import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';

import { AdminTokenMiddleware } from '../admin-token.middleware';

const ADMIN_TOKEN = 'admin-secret-123';
const MOCK_WORKSPACE = {
  id: 'workspace-id',
  displayName: 'Test Workspace',
} as Request['workspace'];

type MockResponse = Response & {
  json: jest.Mock;
  setHeader: jest.Mock;
  status: jest.Mock;
};

describe('AdminTokenMiddleware', () => {
  let middleware: AdminTokenMiddleware;
  let workspaceDomainsService: jest.Mocked<
    Pick<WorkspaceDomainsService, 'getWorkspaceByOriginOrDefaultWorkspace'>
  >;

  const originalEnv = { ...process.env };

  const buildRequest = ({
    authorization,
    forwardedFor = '203.0.113.10',
    cfConnectingIp,
    remoteAddress = '198.51.100.10',
  }: {
    authorization?: string;
    forwardedFor?: string;
    cfConnectingIp?: string;
    remoteAddress?: string;
  } = {}): Request =>
    ({
      headers: {
        ...(authorization ? { authorization } : {}),
        ...(cfConnectingIp ? { 'cf-connecting-ip': cfConnectingIp } : {}),
        origin: 'https://workspace.example.com',
        'x-forwarded-for': forwardedFor,
      },
      path: '/graphql',
      protocol: 'https',
      socket: {
        remoteAddress,
      },
    }) as unknown as Request;

  /**
   * A three-segment JWS, shaped exactly like the token the CRM SPA sends on
   * every authenticated request. Content is irrelevant — the middleware must
   * never even look at it.
   */
  const buildUserJwt = (subject: string) =>
    [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ sub: subject })).toString('base64url'),
      'c2lnbmF0dXJl',
    ].join('.');

  const buildResponse = (): MockResponse => {
    const response = {
      json: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(),
    } as unknown as MockResponse;

    response.json.mockReturnValue(response);
    response.status.mockReturnValue(response);

    return response;
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EXE_CRM_ADMIN_TOKEN: ADMIN_TOKEN,
      // Enable the break-glass admin-token path for the default (enabled) suite.
      ENABLE_ADMIN_TOKEN_LOGIN: 'true',
    };
    delete process.env.EXE_ORG_ID;

    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    workspaceDomainsService = {
      getWorkspaceByOriginOrDefaultWorkspace: jest
        .fn()
        .mockResolvedValue(MOCK_WORKSPACE),
    };

    middleware = new AdminTokenMiddleware(
      workspaceDomainsService as unknown as WorkspaceDomainsService,
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('should allow successful authenticated requests above the failed-attempt limit', async () => {
    for (let index = 0; index < 25; index++) {
      const req = buildRequest({
        authorization: `Bearer ${ADMIN_TOKEN}`,
      });
      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.workspace).toBe(MOCK_WORKSPACE);
      expect(req.workspaceId).toBe(MOCK_WORKSPACE?.id);
      expect(req.adminTokenAuthenticated).toBe(true);
    }

    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).toHaveBeenCalledTimes(25);
  });

  it('should reject the 11th failed attempt with 429 and Retry-After', async () => {
    for (let index = 0; index < 10; index++) {
      const req = buildRequest({
        authorization: 'Bearer wrong-token',
      });
      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }

    const req = buildRequest({
      authorization: 'Bearer wrong-token',
    });
    const res = buildResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: 'rate_limit_exceeded',
      error_description:
        'Too many failed admin token attempts, please try again later',
    });
    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('should reject a matching admin token with 401 when the feature is disabled', async () => {
    delete process.env.ENABLE_ADMIN_TOKEN_LOGIN;

    middleware = new AdminTokenMiddleware(
      workspaceDomainsService as unknown as WorkspaceDomainsService,
    );

    const req = buildRequest({ authorization: `Bearer ${ADMIN_TOKEN}` });
    const res = buildResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.adminTokenAuthenticated).toBeUndefined();
    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('should reject a matching admin token with 401 in a managed deployment', async () => {
    process.env.EXE_ORG_ID = 'org-managed';

    middleware = new AdminTokenMiddleware(
      workspaceDomainsService as unknown as WorkspaceDomainsService,
    );

    const req = buildRequest({ authorization: `Bearer ${ADMIN_TOKEN}` });
    const res = buildResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.adminTokenAuthenticated).toBeUndefined();
    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('should leave requests without Authorization header unaffected', async () => {
    for (let index = 0; index < 10; index++) {
      await middleware.use(
        buildRequest({ authorization: 'Bearer wrong-token' }),
        buildResponse(),
        jest.fn() as NextFunction,
      );
    }

    const req = buildRequest();
    const res = buildResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
    expect(req.adminTokenAuthenticated).toBeUndefined();
  });

  // ── bug 29837293 ─────────────────────────────────────────────────────────
  // The middleware is mounted on /graphql, /metadata, /rest/* and /mcp, so it
  // sees every ordinary authenticated request. It used to count each one as a
  // failed admin-token attempt and 429 the caller after ten, which took the
  // whole SPA down within one page load.
  describe('ordinary user tokens (bug 29837293)', () => {
    it('should not count JWT bearer tokens as failed admin attempts', async () => {
      // Far more Bearer requests than one page load makes, all with the same
      // key. None of them is an admin-token attempt, so none may be counted.
      for (let index = 0; index < 50; index++) {
        const req = buildRequest({
          authorization: `Bearer ${buildUserJwt(`user-${index}`)}`,
        });
        const res = buildResponse();
        const next = jest.fn() as NextFunction;

        await middleware.use(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.adminTokenAuthenticated).toBeUndefined();
      }
    });

    it('should serve a user JWT even while the admin-token bucket is full', async () => {
      for (let index = 0; index < 20; index++) {
        await middleware.use(
          buildRequest({ authorization: 'Bearer opaque-guess' }),
          buildResponse(),
          jest.fn() as NextFunction,
        );
      }

      const req = buildRequest({
        authorization: `Bearer ${buildUserJwt('real-user')}`,
      });
      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('should still authenticate a JWT-shaped admin token', async () => {
      // The fast-path assumes an admin secret is never shaped like a JWT,
      // which holds for the documented `openssl rand -hex 32`. If an operator
      // configures a dotted secret anyway, skipping the comparison would
      // silently stop authenticating the gateway — so the assumption is
      // checked against the real secret, not trusted.
      const dottedToken = buildUserJwt('looks-like-a-jwt-but-is-the-secret');

      process.env.EXE_CRM_ADMIN_TOKEN = dottedToken;

      middleware = new AdminTokenMiddleware(
        workspaceDomainsService as unknown as WorkspaceDomainsService,
      );

      const req = buildRequest({ authorization: `Bearer ${dottedToken}` });
      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.adminTokenAuthenticated).toBe(true);
      expect(req.workspaceId).toBe(MOCK_WORKSPACE?.id);
    });

    it('should still 429 genuine admin-token guessing on the same key', async () => {
      for (let index = 0; index < 10; index++) {
        await middleware.use(
          buildRequest({ authorization: 'Bearer opaque-guess' }),
          buildResponse(),
          jest.fn() as NextFunction,
        );
      }

      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(
        buildRequest({ authorization: 'Bearer opaque-guess' }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  // ── bug 29837293, second defect ──────────────────────────────────────────
  // The limiter keyed on the raw first X-Forwarded-For entry, which the caller
  // writes. Rotating it per request kept the window empty forever, so the
  // limiter never fired on the one thing it existed to stop.
  describe('rate-limit keying (bug 29837293)', () => {
    it('should not let a rotated X-Forwarded-For escape the window', async () => {
      for (let index = 0; index < 10; index++) {
        await middleware.use(
          buildRequest({
            authorization: 'Bearer opaque-guess',
            forwardedFor: `198.18.0.${index}`,
          }),
          buildResponse(),
          jest.fn() as NextFunction,
        );
      }

      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(
        buildRequest({
          authorization: 'Bearer opaque-guess',
          forwardedFor: '198.18.0.250',
        }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should key on the trusted hop, not a client-prepended entry', async () => {
      // Two of our own proxies (cloudflared -> exe-sso-edge) append to the
      // header, so the last believable entry is two from the end. Everything
      // to its left was written by the caller.
      process.env.EXE_TRUSTED_PROXY_HOPS = '2';

      for (let index = 0; index < 10; index++) {
        await middleware.use(
          buildRequest({
            authorization: 'Bearer opaque-guess',
            forwardedFor: `10.0.0.${index}, 203.0.113.7, 172.16.0.1`,
          }),
          buildResponse(),
          jest.fn() as NextFunction,
        );
      }

      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(
        buildRequest({
          authorization: 'Bearer opaque-guess',
          forwardedFor: '10.0.0.99, 203.0.113.7, 172.16.0.1',
        }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should separate distinct callers reported by the trusted hop', async () => {
      process.env.EXE_TRUSTED_PROXY_HOPS = '2';

      for (let index = 0; index < 10; index++) {
        await middleware.use(
          buildRequest({
            authorization: 'Bearer opaque-guess',
            forwardedFor: '10.0.0.1, 203.0.113.7, 172.16.0.1',
          }),
          buildResponse(),
          jest.fn() as NextFunction,
        );
      }

      const res = buildResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(
        buildRequest({
          authorization: 'Bearer opaque-guess',
          // A genuinely different caller: the trusted hop reported a different
          // peer, so this is a different bucket and must not be locked out.
          forwardedFor: '10.0.0.1, 203.0.113.250, 172.16.0.1',
        }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
