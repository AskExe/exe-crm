import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { type CompanyAuthService } from 'src/engine/core-modules/company-auth/company-auth.service';
import { type RestApiCoreService } from 'src/engine/api/rest/core/services/rest-api-core.service';

jest.mock('src/engine/core-modules/company-auth/company-auth.service', () => ({
  CompanyAuthService: class {},
}));
jest.mock('src/engine/api/rest/core/services/rest-api-core.service', () => ({
  RestApiCoreService: class {},
}));
import { CompanyMcpService } from '../company-mcp.service';

const auth = { currentRead: jest.fn() };
const reads = { get: jest.fn() };
const context = {
  workspace: { id: 'workspace' },
  user: { id: 'user' },
  userWorkspaceId: 'member',
  workspaceMemberId: 'native-member',
  workspaceMember: { id: 'native-member' },
};
const key = 'Bearer exk_' + 'A'.repeat(43);
const request = (
  method = 'tools/call',
  id: number | undefined = undefined,
  params: unknown = { name: 'people_list', arguments: { limit: 2 } },
  credential = key,
) =>
  ({
    method: 'POST',
    headers: {
      authorization: credential,
      'mcp-protocol-version': '2025-11-25',
    },
    rawBody: Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        id: method.startsWith('notifications/') ? id : (id ?? 1),
        method,
        params,
      }),
    ),
  }) as unknown as Request & { rawBody: Buffer };
const service = () =>
  new CompanyMcpService(
    auth as unknown as CompanyAuthService,
    reads as unknown as RestApiCoreService,
  );
const signal = () => new AbortController().signal;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRM_COMPANY_MODE = 'true';
  process.env.CRM_COMPANY_MCP_ENABLED = 'true';
  auth.currentRead.mockResolvedValue({ context, fingerprint: 'current' });
  reads.get.mockResolvedValue({ data: { people: [{ id: 'permitted' }] } });
});
afterEach(() => {
  delete process.env.CRM_COMPANY_MODE;
  delete process.env.CRM_COMPANY_MCP_ENABLED;
});

it('calls only native get with explicit user ALS, server-fixed object/depth/limit and fresh authority before return', async () => {
  reads.get.mockImplementation(async (nativeRequest) => {
    expect(getWorkspaceAuthContext().type).toBe('user');
    expect(nativeRequest.path).toBe('/rest/people');
    expect(nativeRequest.query).toEqual({ depth: '0', limit: '2' });
    expect(nativeRequest.apiKey).toBeUndefined();
    return { data: { people: [{ id: 'permitted', name: 'visible' }] } };
  });
  const result = await service().handle(request(), signal());
  expect(result.status).toBe(200);
  expect(auth.currentRead).toHaveBeenCalledTimes(2);
  expect(
    result.value && 'result' in result.value
      ? result.value.result.structuredContent
      : undefined,
  ).toEqual({
    data: { people: [{ id: 'permitted', name: 'visible' }] },
  });
});
it('does not refresh the native lease budget after delayed authorization', async () => {
  const received = Date.now();
  const wallClock = jest.spyOn(Date, 'now');
  auth.currentRead.mockImplementationOnce(async () => {
    wallClock.mockReturnValue(received + 9001);
    return { context, fingerprint: 'current' };
  });
  try {
    await expect(service().handle(request(), signal())).rejects.toMatchObject({
      status: 503,
    });
    expect(reads.get).not.toHaveBeenCalled();
  } finally {
    wallClock.mockRestore();
  }
});
it.each([
  'Bearer eyJ.jwt.signature',
  'Bearer native-key',
  '',
  'Bearer exs_' + 'A'.repeat(43),
])('never falls back for credential %s', async (credential) => {
  await expect(
    service().handle(request('ping', 1, {}, credential), signal()),
  ).rejects.toMatchObject({ status: 401 });
  expect(reads.get).not.toHaveBeenCalled();
  expect(auth.currentRead).not.toHaveBeenCalled();
});
it('denies own cookie or combined browser credentials', async () => {
  const incoming = request();
  incoming.headers.cookie = '__Host-exe_crm_session=exs_' + 'A'.repeat(43);
  await expect(service().handle(incoming, signal())).rejects.toMatchObject({
    status: 401,
  });
});
it('keeps absent/off transport closed', async () => {
  delete process.env.CRM_COMPANY_MCP_ENABLED;
  await expect(service().handle(request(), signal())).rejects.toMatchObject({
    status: 404,
  });
  expect(auth.currentRead).not.toHaveBeenCalled();
});
it('does not admit tools from McpSessionId without fresh key authority', async () => {
  auth.currentRead.mockRejectedValue(new UnauthorizedException());
  const incoming = request();
  incoming.headers['mcp-session-id'] = 'previous';
  await expect(service().handle(incoming, signal())).rejects.toMatchObject({
    status: 401,
  });
  expect(reads.get).not.toHaveBeenCalled();
});
it('denies changed native ACL while native query waits', async () => {
  reads.get.mockImplementation(async () => {
    auth.currentRead.mockResolvedValue({ context, fingerprint: 'downgraded' });
    return { data: { people: [{ private: true }] } };
  });
  await expect(service().handle(request(), signal())).rejects.toMatchObject({
    status: 401,
  });
});
it('denies revoked current Core authority after native read', async () => {
  reads.get.mockImplementation(async () => {
    auth.currentRead.mockRejectedValue(new UnauthorizedException());
    return {};
  });
  await expect(service().handle(request(), signal())).rejects.toMatchObject({
    status: 401,
  });
});
it('maps native inaccessible/missing records uniformly404', async () => {
  reads.get.mockRejectedValue(new ForbiddenException());
  await expect(service().handle(request(), signal())).rejects.toMatchObject({
    status: 404,
  });
});
it('does not serialize a late native success after cancellation', async () => {
  const controller = new AbortController();
  reads.get.mockImplementation(async () => {
    controller.abort();
    return { private: true };
  });
  await expect(
    service().handle(request(), controller.signal),
  ).rejects.toThrow();
});
it('bounds results rather than truncating possibly misleading records', async () => {
  reads.get.mockResolvedValue({ content: 'X'.repeat(262145) });
  await expect(service().handle(request(), signal())).rejects.toMatchObject({
    status: 503,
  });
});
it('has no SSE/session state authority and freshly authorizes GET405', async () => {
  const incoming = request();
  incoming.method = 'GET';
  expect(await service().handle(incoming, signal())).toEqual({ status: 405 });
  expect(auth.currentRead).toHaveBeenCalledTimes(1);
});
it('enforces finite rate budget without native work', async () => {
  const endpoint = service();
  for (let index = 0; index < 30; index++)
    await endpoint.handle(request('ping', index, {}), signal());
  await expect(
    endpoint.handle(request('ping', 31, {}), signal()),
  ).rejects.toMatchObject({ status: 429 });
  expect(reads.get).not.toHaveBeenCalled();
});
it.each([400, 401, 503])(
  'preserves current authority status%s without dispatch',
  async (status) => {
    auth.currentRead.mockRejectedValue(new HttpException('generic', status));
    await expect(service().handle(request(), signal())).rejects.toMatchObject({
      status,
    });
    expect(reads.get).not.toHaveBeenCalled();
  },
);
it('scopes cancellation to the same owned key and cannot clear another duplicate active request', async () => {
  let release: (value: unknown) => void = () => {};
  reads.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const endpoint = service(),
    pending = endpoint.handle(request(), signal());
  // Attach the rejection assertion before cancellation can settle the promise.
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  await expect(endpoint.handle(request(), signal())).rejects.toMatchObject({
    status: 400,
  });
  expect(
    await endpoint.handle(
      request(
        'notifications/cancelled',
        undefined,
        { requestId: 1 },
        'Bearer exk_' + 'B'.repeat(43),
      ),
      signal(),
    ),
  ).toEqual({ status: 202 });
  expect(
    await endpoint.handle(
      request('notifications/cancelled', undefined, { requestId: 1 }),
      signal(),
    ),
  ).toEqual({ status: 202 });
  release({ data: { people: [] } });
  await rejected;
});
it('supports only pinned initialization and static read catalog', async () => {
  const endpoint = service();
  const init = await endpoint.handle(
    request('initialize', 1, {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'controlled', version: '1' },
    }),
    signal(),
  );
  expect(init.status).toBe(200);
  expect(
    (
      await endpoint.handle(
        request('notifications/initialized', undefined, {}),
        signal(),
      )
    ).status,
  ).toBe(202);
  expect(
    (await endpoint.handle(request('tools/list', 2, {}), signal())).status,
  ).toBe(200);
  expect(reads.get).not.toHaveBeenCalled();
});

it('accepts and discards bounded cancellation reason', async () => {
  expect(
    await service().handle(
      request('notifications/cancelled', undefined, {
        requestId: 'finite_1',
        reason: 'caller stopped waiting',
      }),
      signal(),
    ),
  ).toEqual({ status: 202 });
});
it.each([
  null,
  -1,
  1.5,
  9007199254740992,
  '',
  'x'.repeat(65),
  {},
  [],
  'with spaces',
])('denies cancellation identifier drift', async (requestId) => {
  await expect(
    service().handle(
      request('notifications/cancelled', undefined, { requestId }),
      signal(),
    ),
  ).rejects.toThrow();
});
it.each([null, {}, [], 1, '', 'x'.repeat(257), 'line\nbreak'])(
  'denies malformed cancellation reason',
  async (reason) => {
    await expect(
      service().handle(
        request('notifications/cancelled', undefined, { requestId: 1, reason }),
        signal(),
      ),
    ).rejects.toThrow();
  },
);
