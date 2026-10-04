import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

import { RestApiCoreService } from 'src/engine/api/rest/core/services/rest-api-core.service';
import { type AuthenticatedRequest } from 'src/engine/api/rest/types/authenticated-request';
import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { buildUserAuthContext } from 'src/engine/core-modules/auth/utils/build-user-auth-context.util';
import { withCompanyRestReadControl } from '../company-mcp/company-read-lease';
import { companyCredential, companyReadRoute } from './company-auth.policy';
import { CompanyAuthService } from './company-auth.service';

const DEADLINE_MS = 9000;
const RESULT_BYTES = 262144;

@Injectable()
export class CompanyRestReadService {
  private readonly rates = new Map<string, { start: number; count: number }>();
  private active = 0;

  constructor(
    private readonly companyAuth: CompanyAuthService,
    private readonly reads: RestApiCoreService,
  ) {}

  async handle(
    request: Request,
    response: Response,
    signal: AbortSignal,
  ): Promise<void> {
    const configuration = this.companyAuth.configuration;
    if (!configuration || !companyReadRoute(request))
      throw new NotFoundException('Company route unavailable');
    const host = new URL(configuration.origin).host;
    const counts = new Map<string, number>();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index].toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (
      request.rawHeaders.length > 32 ||
      request.rawHeaders.length % 2 !== 0 ||
      [...counts.values()].some((count) => count > 1) ||
      request.headers.host !== host ||
      (request.headers.origin &&
        request.headers.origin !== configuration.origin)
    )
      throw new HttpException('Company request invalid', 400);
    let credential;
    try {
      credential = companyCredential(request);
    } catch {
      throw new HttpException('Company authorization denied', 401);
    }
    const [path, query] = request.originalUrl.split('?');
    const parameters = new URLSearchParams(query);
    const read = Object.freeze({
      object: path.split('/')[2] as 'people' | 'companies',
      id: path.split('/')[3],
      limit: Number(parameters.get('limit')),
    });
    const received = performance.now();
    const absolute = Date.now() + DEADLINE_MS;
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(DEADLINE_MS),
    ]);
    const check = () => {
      if (
        combined.aborted ||
        performance.now() - received >= DEADLINE_MS ||
        Date.now() >= absolute
      )
        throw new ServiceUnavailableException('Company read unavailable');
    };
    check();
    const hash = createHash('sha256')
      .update(credential.kind + ':' + credential.value)
      .digest('hex');
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
    try {
      const current = await this.companyAuth.currentRead(request, combined);
      check();
      const context = current.context;
      if (
        !context.workspace ||
        context.workspace.id !== configuration.workspaceId ||
        !context.user ||
        !context.userWorkspaceId ||
        !context.workspaceMemberId ||
        !context.workspaceMember
      )
        throw new ServiceUnavailableException('Company identity unavailable');
      const userContext = buildUserAuthContext({
        workspace: context.workspace,
        user: context.user,
        userWorkspaceId: context.userWorkspaceId,
        workspaceMemberId: context.workspaceMemberId,
        workspaceMember: context.workspaceMember,
      });
      const headers =
        credential.kind === 'key'
          ? { authorization: 'Bearer ' + credential.value }
          : { cookie: '__Host-exe_crm_session=' + credential.value };
      // Only server-created native DTO fields; never merge caller workspace/actor.
      const nativeRequest = {
        headers,
        method: 'GET',
        path,
        originalUrl: path + '?depth=0&limit=' + read.limit,
        query: { depth: '0', limit: String(read.limit) },
        ...userContext,
      } as unknown as AuthenticatedRequest;
      let value: unknown;
      try {
        value = await withWorkspaceAuthContext(userContext, () =>
          withCompanyRestReadControl(
            {
              signal: combined,
              read,
              monotonicDeadline: received + DEADLINE_MS,
              absoluteDeadline: absolute,
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
      // Native terminal queries and rollback/release have finished before providers.
      check();
      const latest = await this.companyAuth.currentRead(request, combined);
      check();
      if (latest.fingerprint !== current.fingerprint)
        throw new HttpException('Company permissions changed', 401);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ServiceUnavailableException('Company result invalid');
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > RESULT_BYTES)
        throw new ServiceUnavailableException('Company result bound');
      check();
      response.setHeader('Cache-Control', 'no-store');
      response.type('application/json').status(200).send(text);
    } finally {
      this.active--;
    }
  }
}
