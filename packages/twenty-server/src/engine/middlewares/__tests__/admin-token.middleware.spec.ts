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
  }: {
    authorization?: string;
    forwardedFor?: string;
  } = {}): Request =>
    ({
      headers: {
        ...(authorization ? { authorization } : {}),
        origin: 'https://workspace.example.com',
        'x-forwarded-for': forwardedFor,
      },
      path: '/graphql',
      protocol: 'https',
      socket: {
        remoteAddress: '198.51.100.10',
      },
    }) as unknown as Request;

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
    };

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
});
