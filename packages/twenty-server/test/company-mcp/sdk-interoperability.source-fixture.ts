// Explicit opt-in SOURCE fixture: not actual Core/native A/B/PG/browser proof.
jest.mock('src/engine/core-modules/company-auth/company-auth.service', () => ({
  CompanyAuthService: class {},
}));
jest.mock('src/engine/api/rest/core/services/rest-api-core.service', () => ({
  RestApiCoreService: class {},
}));

import { createRequire } from 'node:module';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type Request } from 'express';
import { CompanyAuthService } from 'src/engine/core-modules/company-auth/company-auth.service';
import { type CompanyAuthConfiguration } from 'src/engine/core-modules/company-auth/company-auth.config';
import { companyAuthIngress } from 'src/engine/core-modules/company-auth/company-auth.ingress';
import { RestApiCoreService } from 'src/engine/api/rest/core/services/rest-api-core.service';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { CompanyMcpController } from 'src/engine/core-modules/company-mcp/company-mcp.controller';
import { CompanyMcpService } from 'src/engine/core-modules/company-mcp/company-mcp.service';

type Tool = { name: string };
type ToolResult = { structuredContent?: Record<string, unknown> };
type Client = {
  connect: (transport: object) => Promise<void>;
  listTools: () => Promise<{ tools: Tool[] }>;
  callTool: (
    params: { name: string; arguments: Record<string, unknown> },
    schema?: unknown,
    options?: { signal: AbortSignal },
  ) => Promise<ToolResult>;
  close: () => Promise<void>;
};
type Sdk = {
  Client: new (
    implementation: { name: string; version: string },
    options: { capabilities: object },
  ) => Client;
  StreamableHTTPClientTransport: new (
    url: URL,
    options: {
      requestInit: { headers: Record<string, string> };
      fetch: typeof fetch;
    },
  ) => object;
};
const source = process.env.COMPANY_MCP_SDK_CACHE;
if (
  !source ||
  !source.startsWith('/') ||
  realpathSync(source) !== source ||
  JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')).version !==
    '1.29.0'
)
  throw new Error('Exact read-only cached SDK1.29.0 required');
const requireSdk = createRequire(__filename);
const { Client: OfficialClient } = requireSdk(
  resolve(source, 'dist/cjs/client/index.js'),
) as Pick<Sdk, 'Client'>;
const { StreamableHTTPClientTransport } = requireSdk(
  resolve(source, 'dist/cjs/client/streamableHttp.js'),
) as Pick<Sdk, 'StreamableHTTPClientTransport'>;
const key = 'Bearer exk_' + 'A'.repeat(43);
const otherKey = 'Bearer exk_' + 'B'.repeat(43);
const fixedOrigin = 'https://crm.alpha.example.test';
const fixedHost = 'crm.alpha.example.test';
const id = '00000000-0000-4000-8000-000000000001';
const context = {
  workspace: { id: 'fixed-native-workspace' },
  user: { id: 'fixed-native-user' },
  userWorkspaceId: 'fixed-membership',
  workspaceMemberId: 'fixed-native-member',
  workspaceMember: { id: 'fixed-native-member' },
};
const authority = { currentRead: jest.fn() };
const native = { get: jest.fn() };
@Module({
  controllers: [CompanyMcpController],
  providers: [
    CompanyMcpService,
    { provide: CompanyAuthService, useValue: authority },
    { provide: RestApiCoreService, useValue: native },
  ],
})
class SourceFixtureModule {}
let application: NestExpressApplication;
let url: string;
let client: Client;
const clients: Client[] = [];
const releaseReads: (() => void)[] = [];
const sent: { rpc?: Record<string, unknown>; primaryCredential: boolean }[] =
  [];
const traces: {
  method: string;
  rpc?: Record<string, unknown>;
  status: number;
  protocol?: string | null;
}[] = [];
const localFetch: typeof fetch = async (input, init) => {
  const target =
    input instanceof globalThis.Request ? input.url : String(input);
  if (target !== url)
    throw new Error('Fixture network outside exact owned loopback denied');
  sent.push({
    ...(typeof init?.body === 'string' ? { rpc: JSON.parse(init.body) } : {}),
    primaryCredential: new Headers(init?.headers).get('authorization') === key,
  });
  // Node's built-in fetch normalizes Host to its loopback URL. A Fetch-compatible
  // Node HTTP transport preserves the SDK's fixed Host/Origin on the real wire;
  // it does not alter ingress, credentials, framing or SDK-generated protocol.
  const response = await new Promise<globalThis.Response>(
    (resolveResponse, reject) => {
      const endpoint = new URL(target);
      const headers = Object.fromEntries(new Headers(init?.headers));
      const body = init?.body;
      if (
        body !== undefined &&
        (typeof body !== 'string' || Buffer.byteLength(body) > 8192)
      ) {
        reject(new Error('Fixture body bound'));
        return;
      }
      if (body !== undefined)
        headers['content-length'] = String(Buffer.byteLength(body as string));
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: endpoint.port,
          path: endpoint.pathname,
          method: init?.method ?? 'GET',
          headers,
          timeout: 3000,
          signal: init?.signal ?? undefined,
        },
        (reply) => {
          const parts: Buffer[] = [];
          let bytes = 0;
          reply.on('data', (part) => {
            bytes += part.length;
            if (bytes > 1048576) {
              request.destroy(new Error('Fixture response bound'));
              return;
            }
            parts.push(part);
          });
          reply.once('error', reject);
          reply.once('end', () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(reply.headers))
              if (value !== undefined)
                responseHeaders.set(
                  name,
                  Array.isArray(value) ? value.join(', ') : value,
                );
            resolveResponse(
              new globalThis.Response(Buffer.concat(parts), {
                status: reply.statusCode,
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      request.once('timeout', () =>
        request.destroy(new Error('Fixture wire deadline')),
      );
      request.once('error', reject);
      request.end(body);
    },
  );
  traces.push({
    method: init?.method ?? 'GET',
    ...(typeof init?.body === 'string' ? { rpc: JSON.parse(init.body) } : {}),
    status: response.status,
    protocol: new Headers(init?.headers).get('mcp-protocol-version'),
  });
  return response;
};
const createClient = (credential = key) => {
  const next = new OfficialClient(
    { name: 'controlled-source-client', version: '1' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Host: fixedHost,
        Origin: fixedOrigin,
        Authorization: credential,
      },
    },
    fetch: localFetch,
  });
  clients.push(next);
  return { next, transport };
};
beforeEach(async () => {
  jest.useRealTimers();
  process.env.CRM_COMPANY_MODE = 'true';
  process.env.CRM_COMPANY_MCP_ENABLED = 'true';
  traces.length = 0;
  sent.length = 0;
  authority.currentRead.mockReset();
  native.get.mockReset();
  authority.currentRead.mockResolvedValue({
    context,
    fingerprint: 'current-permissions',
  });
  native.get.mockImplementation(async (request: Request) => {
    expect(getWorkspaceAuthContext().type).toBe('user');
    return { data: { path: request.path, query: request.query } };
  });
  application = await NestFactory.create<NestExpressApplication>(
    SourceFixtureModule,
    { rawBody: true, logger: false },
  );
  application.use(
    companyAuthIngress({ origin: fixedOrigin } as CompanyAuthConfiguration),
  );
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address() as { port: number };
  url = `http://127.0.0.1:${address.port}/company-mcp`;
});
afterEach(async () => {
  for (const release of releaseReads.splice(0)) release();
  for (const entry of clients.splice(0)) await entry.close();
  await application?.close();
  delete process.env.CRM_COMPANY_MODE;
  delete process.env.CRM_COMPANY_MCP_ENABLED;
});
const connect = async () => {
  const { next, transport } = createClient();
  client = next;
  await client.connect(transport);
};
const raw = async (params: unknown, credential = key) =>
  localFetch(url, {
    method: 'POST',
    headers: {
      Host: fixedHost,
      Origin: fixedOrigin,
      Authorization: credential,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(params),
  });

it('official SDK initializes, accepts initialized and GET405, lists and calls all four fixed tools', async () => {
  await connect();
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
    'people_list',
    'person_get',
    'customers_list',
    'customer_get',
  ]);
  for (const [name, args, path] of [
    ['people_list', { limit: 2 }, '/rest/people'],
    ['person_get', { id }, '/rest/people/' + id],
    ['customers_list', { limit: 3 }, '/rest/companies'],
    ['customer_get', { id }, '/rest/companies/' + id],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.structuredContent).toMatchObject({
      data: { path, query: { depth: '0' } },
    });
  }
  expect(
    traces.some(
      (entry) => entry.rpc?.method === 'initialize' && entry.status === 200,
    ),
  ).toBe(true);
  expect(
    traces.some(
      (entry) =>
        entry.rpc?.method === 'notifications/initialized' &&
        entry.status === 202,
    ),
  ).toBe(true);
  expect(
    traces.some((entry) => entry.method === 'GET' && entry.status === 405),
  ).toBe(true);
  expect(
    traces
      .filter((entry) => entry.rpc?.method !== 'initialize')
      .every((entry) => entry.protocol === '2025-11-25'),
  ).toBe(true);
  expect(native.get).toHaveBeenCalledTimes(4);
});
it.each([400, 401, 503])(
  'official SDK preserves explicit current authority denial%s without native work',
  async (status) => {
    await connect();
    authority.currentRead.mockRejectedValue(
      new HttpException('generic', status),
    );
    await expect(
      client.callTool({ name: 'people_list', arguments: { limit: 1 } }),
    ).rejects.toMatchObject({ code: status });
    expect(native.get).not.toHaveBeenCalled();
    expect(traces[traces.length - 1]?.status).toBe(status);
  },
);
it('revocation during read denies final current check and never releases native result', async () => {
  await connect();
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
    releaseReads.push(resolve);
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  native.get.mockImplementation(async () => {
    started();
    await gate;
    return { data: { mustNotRelease: true } };
  });
  const pending = client.callTool({
    name: 'people_list',
    arguments: { limit: 1 },
  });
  await entered;
  authority.currentRead.mockRejectedValue(new HttpException('revoked', 401));
  finish();
  await expect(pending).rejects.toMatchObject({ code: 401 });
  expect(traces[traces.length - 1]?.status).toBe(401);
});
it('official SDK cancellation supplies optional reason, remains same-key scoped and cannot return late success', async () => {
  await connect();
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
    releaseReads.push(resolve);
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  native.get.mockImplementation(async () => {
    started();
    await gate;
    return { data: { mustNotRelease: true } };
  });
  const controller = new AbortController();
  const pending = client.callTool(
    { name: 'people_list', arguments: { limit: 1 } },
    undefined,
    { signal: controller.signal },
  );
  await entered;
  const sentTool = sent.find((entry) => entry.rpc?.method === 'tools/call');
  const requestId = sentTool?.rpc?.id;
  expect(typeof requestId).toBe('number');
  const foreign = await raw(
    {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId, reason: 'foreign finite reason' },
    },
    otherKey,
  );
  expect(foreign.status).toBe(202);
  await foreign.body?.cancel();
  expect(traces.some((entry) => entry.rpc?.method === 'tools/call')).toBe(
    false,
  );
  expect(authority.currentRead).toHaveBeenCalled();
  controller.abort('source caller stopped waiting');
  await expect(pending).rejects.toThrow('source caller stopped waiting');
  // Wait for the real cancellation HTTP notification to finish before releasing.
  for (
    let index = 0;
    index < 100 &&
    !traces.some(
      (entry) =>
        entry.rpc?.method === 'notifications/cancelled' &&
        (entry.rpc.params as { reason?: string })?.reason ===
          'source caller stopped waiting',
    );
    index++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  const cancellation = traces.find(
    (entry) =>
      entry.rpc?.method === 'notifications/cancelled' &&
      (entry.rpc.params as { reason?: string })?.reason ===
        'source caller stopped waiting',
  );
  expect(cancellation?.status).toBe(202);
  expect(cancellation?.rpc?.params).toMatchObject({
    reason: 'source caller stopped waiting',
  });
  expect(cancellation?.rpc?.params).toMatchObject({ requestId });
  finish();
  for (
    let index = 0;
    index < 100 && !traces.some((entry) => entry.rpc?.method === 'tools/call');
    index++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(
    traces.find((entry) => entry.rpc?.method === 'tools/call')?.status,
  ).toBe(503);
});
it('shipped ingress denies foreign Origin, selectors and version drift', async () => {
  const denied = await localFetch(url, {
    method: 'POST',
    headers: {
      Host: fixedHost,
      Origin: 'https://foreign.test',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: key,
    },
    body: '{}',
  });
  expect(denied.status).toBe(403);
  await denied.body?.cancel();
  const selector = await raw({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'people_list',
      arguments: { limit: 1, workspace: 'foreign' },
    },
  });
  expect(selector.status).toBe(400);
  await selector.body?.cancel();
  const version = await localFetch(url, {
    method: 'POST',
    headers: {
      Host: fixedHost,
      Origin: fixedOrigin,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: key,
      'MCP-Protocol-Version': '2026-01-01',
    },
    body: '{"jsonrpc":"2.0","id":2,"method":"ping"}',
  });
  expect(version.status).toBe(400);
  await version.body?.cancel();
  expect(native.get).not.toHaveBeenCalled();
});

it('actual HTTP duplicate authorization is denied before controlled authority/native work', async () => {
  const endpoint = new URL(url);
  const status = await new Promise<number | undefined>(
    (resolveResponse, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: endpoint.port,
          path: endpoint.pathname,
          method: 'POST',
          headers: {
            Host: fixedHost,
            Origin: fixedOrigin,
            Authorization: [key, key],
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Content-Length': '2',
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolveResponse(response.statusCode));
        },
      );
      request.once('timeout', () =>
        request.destroy(new Error('Fixture wire deadline')),
      );
      request.once('error', reject);
      request.end('{}');
    },
  );
  expect(status).toBe(400);
  expect(authority.currentRead).not.toHaveBeenCalled();
  expect(native.get).not.toHaveBeenCalled();
});

it('foreign-key real HTTP cancellation cannot cancel an SDK native read', async () => {
  await connect();
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
    releaseReads.push(resolve);
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  native.get.mockImplementation(async () => {
    started();
    await gate;
    return { data: { permitted: true } };
  });
  const pending = client.callTool({
    name: 'people_list',
    arguments: { limit: 1 },
  });
  await entered;
  const requestId = sent.find((entry) => entry.rpc?.method === 'tools/call')
    ?.rpc?.id;
  const response = await raw(
    {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId, reason: 'different key stopped waiting' },
    },
    otherKey,
  );
  expect(response.status).toBe(202);
  await response.body?.cancel();
  finish();
  expect((await pending).structuredContent).toEqual({
    data: { permitted: true },
  });
  expect(
    traces.find((entry) => entry.rpc?.method === 'tools/call')?.status,
  ).toBe(200);
});
it.each([403, 404])(
  'official SDK sees uniform404 for native inaccessible/missing record%s',
  async (status) => {
    await connect();
    native.get.mockRejectedValue(
      new HttpException('controlled native denied', status),
    );
    await expect(
      client.callTool({ name: 'person_get', arguments: { id } }),
    ).rejects.toMatchObject({ code: 404 });
    expect(traces[traces.length - 1]?.status).toBe(404);
  },
);
it('official SDK also crosses the exact frozen edge header route into shipped ingress/controller/service', async () => {
  const edgeSource = process.env.COMPANY_MCP_EDGE_SOURCE;
  if (
    !edgeSource ||
    !edgeSource.startsWith('/') ||
    realpathSync(edgeSource) !== edgeSource ||
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: edgeSource,
      encoding: 'utf8',
    }).trim() !== 'e02940be74b927a739cf47b2df60ce5049673536'
  )
    throw new Error('Exact frozen edge source required');
  execFileSync(
    'git',
    ['diff', '--exit-code', 'HEAD', '--', 'src/tenant-edge'],
    { cwd: edgeSource, stdio: 'pipe' },
  );
  const central = url;
  const script = `import {pathToFileURL} from 'node:url'; const {configuration}=await import(pathToFileURL(${JSON.stringify(resolve(edgeSource, 'src/tenant-edge/policy.mjs'))})); const {createTenantEdge}=await import(pathToFileURL(${JSON.stringify(resolve(edgeSource, 'src/tenant-edge/server.mjs'))})); const c=configuration(${JSON.stringify({ TENANT_EDGE_ENABLED: 'true', TENANT_EDGE_PRODUCT: 'crm', TENANT_EDGE_ORIGIN: fixedOrigin, TENANT_EDGE_AUTH_ORIGIN: 'https://auth.alpha.example.test', TENANT_EDGE_COMPANY_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TENANT_EDGE_CLIENT_ID: 'crm-alpha', TENANT_EDGE_UPSTREAM: 'http://tenant-native:3000' })}); const server=createTenantEdge({...c,upstream:${JSON.stringify(new URL(central).origin)}}); server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\\n')); process.once('SIGTERM',async()=>{await server.closeGracefully();process.exit(0)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: edgeSource,
    env: { PATH: process.env.PATH },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('exit', resolveExit);
    child.once('error', () => resolveExit(-1));
  });
  try {
    const port = await new Promise<number>((resolvePort, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Owned edge startup deadline')),
        3000,
      );
      let output = '';
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(deadline);
        reject(new Error('Owned edge startup failed'));
      });
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.length > 256) {
          clearTimeout(deadline);
          reject(new Error('Owned edge output bound'));
          return;
        }
        if (output.includes('\n')) {
          clearTimeout(deadline);
          try {
            const value = JSON.parse(output);
            if (
              !Number.isInteger(value.port) ||
              value.port < 1 ||
              value.port > 65535
            )
              throw new Error('Invalid owned port');
            resolvePort(value.port);
          } catch {
            reject(new Error('Owned edge startup failed'));
          }
        }
      });
    });
    url = `http://127.0.0.1:${port}/company-mcp`;
    await connect();
    expect((await client.listTools()).tools).toHaveLength(4);
    const result = await client.callTool({
      name: 'customers_list',
      arguments: { limit: 2 },
    });
    expect(result.structuredContent).toMatchObject({
      data: { path: '/rest/companies', query: { depth: '0', limit: '2' } },
    });
    expect(
      traces.some((entry) => entry.method === 'GET' && entry.status === 405),
    ).toBe(true);
    expect(
      traces
        .filter((entry) => entry.rpc?.method !== 'initialize')
        .every((entry) => entry.protocol === '2025-11-25'),
    ).toBe(true);
  } finally {
    await client?.close();
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    const kill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
    }, 3000);
    const code = await exited;
    clearTimeout(kill);
    url = central;
    expect(code).toBe(0);
  }
});
