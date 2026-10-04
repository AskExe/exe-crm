import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Request } from 'express';

import { RestApiCoreService } from 'src/engine/api/rest/core/services/rest-api-core.service';
import { type AuthenticatedRequest } from 'src/engine/api/rest/types/authenticated-request';
import { wrapJsonRpcResponse } from 'src/engine/api/mcp/utils/wrap-jsonrpc-response.util';
import { CompanyAuthService } from 'src/engine/core-modules/company-auth/company-auth.service';
import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';

import { companyMcpEnabled } from './company-mcp.config';
import {
  COMPANY_READ_CONTROL_MAX_MS,
  withCompanyReadControl,
} from './company-read-lease';
import {
  COMPANY_MCP_DEADLINE_MS,
  COMPANY_MCP_RESULT_BYTES,
  COMPANY_MCP_VERSION,
  COMPANY_READ_TOOLS,
  CompanyProtocolError,
  companyToolRead,
  companyRpcIdentifier,
  parseCompanyRpc,
} from './company-mcp.protocol';

@Injectable()
export class CompanyMcpService {
  private readonly pending = new Map<string, AbortController>();
  private readonly rates = new Map<string, { start: number; count: number }>();
  private active = 0;
  constructor(
    private readonly companyAuth: CompanyAuthService,
    private readonly reads: RestApiCoreService,
  ) {}

  async handle(request: Request & { rawBody?: Buffer }, signal: AbortSignal) {
    if (!companyMcpEnabled()) throw new NotFoundException();
    const credential = request.headers.authorization;
    if (
      request.headers.cookie ||
      typeof credential !== 'string' ||
      !/^Bearer exk_[A-Za-z0-9_-]{43}$/.test(credential)
    )
      throw new HttpException('Company credential required', 401);
    const hash = createHash('sha256').update(credential).digest('hex');
    const received = performance.now(),
      absolute = Date.now() + COMPANY_MCP_DEADLINE_MS;
    const check = () => {
      if (
        signal.aborted ||
        performance.now() - received >= COMPANY_MCP_DEADLINE_MS ||
        Date.now() >= absolute
      )
        throw new ServiceUnavailableException('Company read unavailable');
    };
    const now = Date.now();
    for (const [key, rate] of this.rates)
      if (now - rate.start >= 60000) this.rates.delete(key);
    const rate = this.rates.get(hash) ?? { start: now, count: 0 };
    if (
      (this.rates.size >= 256 && !this.rates.has(hash)) ||
      rate.count >= 30 ||
      this.active >= 8
    )
      throw new HttpException('Company rate limit', 429);
    rate.count++;
    this.rates.set(hash, rate);
    this.active++;
    let operation: string | undefined;
    try {
      check();
      const current = await this.companyAuth.currentRead(request, signal);
      check();
      if (
        request.headers['mcp-protocol-version'] !== undefined &&
        request.headers['mcp-protocol-version'] !== COMPANY_MCP_VERSION
      )
        throw new BadRequestException('Unsupported company protocol');
      if (request.method === 'GET' || request.method === 'DELETE')
        return { status: 405 };
      const rpc = parseCompanyRpc(request.rawBody ?? Buffer.alloc(0));
      if (
        rpc.method !== 'initialize' &&
        request.headers['mcp-protocol-version'] !== COMPANY_MCP_VERSION
      )
        throw new BadRequestException('Unsupported company protocol');
      const params = rpc.params ?? {};
      let result: Record<string, unknown>;
      if (rpc.method === 'notifications/initialized') {
        if (rpc.id !== undefined || Object.keys(params).length)
          throw new CompanyProtocolError();
        return { status: 202 };
      }
      if (rpc.method === 'notifications/cancelled') {
        if (
          rpc.id !== undefined ||
          Object.keys(params).some(
            (name) => !['requestId', 'reason'].includes(name),
          ) ||
          !companyRpcIdentifier(params.requestId) ||
          (params.reason !== undefined &&
            (typeof params.reason !== 'string' ||
              !/^[\x20-\x7e]{1,256}$/.test(params.reason)))
        )
          throw new CompanyProtocolError();
        this.pending
          .get(hash + ':' + JSON.stringify(params.requestId))
          ?.abort();
        return { status: 202 };
      }
      if (rpc.id === undefined) throw new CompanyProtocolError();
      const operationKey = hash + ':' + JSON.stringify(rpc.id);
      if (this.pending.has(operationKey))
        throw new BadRequestException('Duplicate company request');
      operation = operationKey;
      const controller = new AbortController();
      this.pending.set(operation, controller);
      const combined = AbortSignal.any([signal, controller.signal]);
      if (rpc.method === 'initialize') {
        if (
          params.protocolVersion !== COMPANY_MCP_VERSION ||
          !params.clientInfo ||
          typeof params.clientInfo !== 'object' ||
          Array.isArray(params.clientInfo) ||
          !params.capabilities ||
          typeof params.capabilities !== 'object' ||
          Array.isArray(params.capabilities) ||
          Object.keys(params).some(
            (name) =>
              !['protocolVersion', 'clientInfo', 'capabilities'].includes(name),
          )
        )
          throw new CompanyProtocolError(-32602);
        const clientInfo = params.clientInfo as Record<string, unknown>;
        if (
          Object.keys(clientInfo).some(
            (name) => !['name', 'version'].includes(name),
          ) ||
          !['name', 'version'].every(
            (name) =>
              typeof clientInfo[name] === 'string' &&
              /^[A-Za-z0-9_. -]{1,128}$/.test(clientInfo[name] as string),
          )
        )
          throw new CompanyProtocolError(-32602);
        result = {
          protocolVersion: COMPANY_MCP_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'Exe company CRM read', version: '1' },
        };
      } else if (rpc.method === 'ping' || rpc.method === 'tools/list') {
        if (Object.keys(params).length) throw new CompanyProtocolError(-32602);
        result = rpc.method === 'ping' ? {} : { tools: COMPANY_READ_TOOLS };
      } else if (rpc.method === 'tools/call') {
        const read = companyToolRead(rpc.params);
        const context = current.context;
        if (
          !context.workspace ||
          !context.userWorkspaceId ||
          !context.user ||
          !context.workspaceMemberId ||
          !context.workspaceMember
        )
          throw new ServiceUnavailableException();
        const userContext = buildUserAuthContext({
          workspace: context.workspace,
          userWorkspaceId: context.userWorkspaceId,
          user: context.user,
          workspaceMemberId: context.workspaceMemberId,
          workspaceMember: context.workspaceMember,
        });
        const path = '/rest/' + read.object + (read.id ? '/' + read.id : '');
        // Exact in-process DTO: never merge caller params or make an HTTP proxy.
        const nativeRequest = {
          headers: { authorization: credential },
          path,
          query: { depth: '0', limit: String(read.limit) },
          method: 'GET',
          originalUrl: path + '?depth=0&limit=' + read.limit,
          ...userContext,
        } as unknown as AuthenticatedRequest;
        combined.throwIfAborted();
        check();
        let value: unknown;
        try {
          value = await withWorkspaceAuthContext(userContext, () =>
            withCompanyReadControl(
              {
                signal: combined,
                read,
                // Native leases retain their stricter nine-second request budget.
                monotonicDeadline:
                  received +
                  Math.min(
                    COMPANY_MCP_DEADLINE_MS,
                    COMPANY_READ_CONTROL_MAX_MS,
                  ),
                absoluteDeadline: Math.min(
                  absolute,
                  absolute -
                    COMPANY_MCP_DEADLINE_MS +
                    COMPANY_READ_CONTROL_MAX_MS,
                ),
              },
              () => this.reads.get(nativeRequest),
            ),
          );
        } catch (error) {
          if (
            error instanceof HttpException &&
            [403, 404].includes(error.getStatus())
          )
            throw new NotFoundException('Record unavailable');
          if (
            error instanceof HttpException &&
            [400, 401, 503].includes(error.getStatus())
          )
            throw new HttpException(
              'Company read unavailable',
              error.getStatus(),
            );
          throw new ServiceUnavailableException('Company read unavailable');
        }
        // No native transaction/lease spans this fresh provider reauthorization.
        combined.throwIfAborted();
        check();
        const latest = await this.companyAuth.currentRead(request, combined);
        combined.throwIfAborted();
        check();
        if (latest.fingerprint !== current.fingerprint)
          throw new HttpException('Company permissions changed', 401);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new ServiceUnavailableException('Company result invalid');
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) > COMPANY_MCP_RESULT_BYTES)
          throw new ServiceUnavailableException('Company result bound');
        result = {
          content: [{ type: 'text', text }],
          structuredContent: value,
        };
      } else throw new CompanyProtocolError(-32601);
      combined.throwIfAborted();
      check();
      return { status: 200, value: wrapJsonRpcResponse(rpc.id, { result }) };
    } finally {
      if (operation) this.pending.delete(operation);
      this.active--;
    }
  }
}
