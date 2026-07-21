import { type NextFunction, type Request, type Response } from 'express';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { AdminTokenMiddleware } from 'src/engine/middlewares/admin-token.middleware';

const MOCK_WORKSPACE = {
  id: 'workspace-id',
  displayName: 'Exe',
  activationStatus: WorkspaceActivationStatus.ACTIVE,
};

const mockResponse = () => {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

const mockRequest = (token: string): Request =>
  ({
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'http://app.example.com',
      'x-forwarded-for': '203.0.113.10',
    },
    socket: {
      remoteAddress: '203.0.113.10',
    },
    path: '/graphql',
  }) as unknown as Request;

describe('AdminTokenMiddleware', () => {
  const originalEnv = { ...process.env };
  let workspaceDomainsService: {
    getWorkspaceByOriginOrDefaultWorkspace: jest.Mock;
  };
  let middleware: AdminTokenMiddleware;

  beforeEach(() => {
    process.env.EXE_CRM_ADMIN_TOKEN = 'admin-secret-123';

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

  it('does not rate limit repeated successful authenticated admin requests', async () => {
    for (let requestIndex = 0; requestIndex < 12; requestIndex++) {
      const request = mockRequest('admin-secret-123');
      const response = mockResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(request, response, next);

      expect(response.status).not.toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalledTimes(1);
      expect(request.adminTokenAuthenticated).toBe(true);
      expect(request.workspaceId).toBe(MOCK_WORKSPACE.id);
    }

    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).toHaveBeenCalledTimes(12);
  });

  it('rate limits repeated failed admin token attempts', async () => {
    for (let requestIndex = 0; requestIndex < 10; requestIndex++) {
      const request = mockRequest('wrong-token');
      const response = mockResponse();
      const next = jest.fn() as NextFunction;

      await middleware.use(request, response, next);

      expect(response.status).not.toHaveBeenCalledWith(429);
      expect(next).toHaveBeenCalledTimes(1);
      expect(request.adminTokenAuthenticated).toBeUndefined();
    }

    const blockedRequest = mockRequest('wrong-token');
    const blockedResponse = mockResponse();
    const blockedNext = jest.fn() as NextFunction;

    await middleware.use(blockedRequest, blockedResponse, blockedNext);

    expect(blockedResponse.status).toHaveBeenCalledWith(429);
    expect(blockedResponse.json).toHaveBeenCalledWith({
      error: 'Too many requests - try again later.',
    });
    expect(blockedNext).not.toHaveBeenCalled();
    expect(
      workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace,
    ).not.toHaveBeenCalled();
  });

  it('authenticates a valid admin token after failed attempts are limited', async () => {
    for (let requestIndex = 0; requestIndex < 10; requestIndex++) {
      await middleware.use(
        mockRequest('wrong-token'),
        mockResponse(),
        jest.fn() as NextFunction,
      );
    }

    const request = mockRequest('admin-secret-123');
    const response = mockResponse();
    const next = jest.fn() as NextFunction;

    await middleware.use(request, response, next);

    expect(response.status).not.toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(1);
    expect(request.adminTokenAuthenticated).toBe(true);
  });
});
