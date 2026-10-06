import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { HttpException, Injectable } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { CompanyAuthService } from './company-auth.service';
import {
  readCompanyBrowserConfiguration,
  type CompanyBrowserConfiguration,
} from './company-browser.config';
import {
  browserPath,
  browserRequest,
  CompanyBrowserError,
  COMPANY_FLOW_COOKIE,
  COMPANY_SESSION_COOKIE,
  COMPANY_SESSION_TOKEN,
  openCompanyFlow,
  parseBrowserProvider,
  sealCompanyFlow,
  stateHash,
} from './company-browser.protocol';

@Injectable()
export class CompanyBrowserService {
  readonly configuration: CompanyBrowserConfiguration | null;
  private active = 0;
  private rate = { started: performance.now(), count: 0 };

  constructor(private readonly auth: CompanyAuthService) {
    this.configuration = readCompanyBrowserConfiguration(auth.configuration);
  }

  accepts(request: Request): boolean {
    return Boolean(this.configuration) && browserPath(request.originalUrl);
  }

  private async privateCall(
    operation: 'token' | 'revoke',
    body: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const configuration = this.auth.configuration;
    if (!configuration) throw new CompanyBrowserError(503);
    const response = await fetch(
      configuration.brokerUrl + '/internal/session-broker/' + operation,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Basic ' +
            Buffer.from(
              configuration.clientId + ':' + configuration.clientSecret,
            ).toString('base64'),
        },
        body: JSON.stringify(body),
      },
    );
    if ([400, 401, 403].includes(response.status))
      throw new CompanyBrowserError(response.status);
    if (
      response.status !== 200 ||
      !response.body ||
      response.headers.get('content-type') !== 'application/json' ||
      response.headers.get('content-encoding')
    )
      throw new CompanyBrowserError(503);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) throw new CompanyBrowserError(503);
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel();
    }
    return parseBrowserProvider(Buffer.concat(chunks));
  }

  async handle(request: Request, response: Response): Promise<void> {
    const configuration = this.auth.configuration;
    const browser = this.configuration;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    const controller = new AbortController();
    const mono = performance.now() + 9000,
      wall = Date.now() + 9000;
    const timer = setTimeout(() => controller.abort(), 9000);
    const abort = () => controller.abort();
    request.once('aborted', abort);
    const closed = () => {
      if (!response.writableEnded) abort();
    };
    response.once('close', closed);
    const check = () => {
      if (
        controller.signal.aborted ||
        performance.now() >= mono ||
        Date.now() >= wall
      )
        throw new CompanyBrowserError(503);
    };
    let admitted = false;
    try {
      check();
      if (!configuration || !browser) throw new CompanyBrowserError(404);
      const { path, cookies, parameters } = browserRequest(
        request,
        configuration,
      );
      if (performance.now() - this.rate.started >= 60000)
        this.rate = { started: performance.now(), count: 0 };
      if (++this.rate.count > 120) throw new CompanyBrowserError(429);
      if (this.active >= 8) throw new CompanyBrowserError(503);
      this.active++;
      admitted = true;
      const cookieOptions = {
        secure: true,
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
      };
      if (path === '/company-session/start') {
        const state = randomBytes(32).toString('base64url'),
          verifier = randomBytes(32).toString('base64url');
        const flow = sealCompanyFlow(configuration, browser, state, verifier);
        const query = new URLSearchParams({
          client_id: configuration.clientId,
          state,
          code_challenge: Buffer.from(stateHash(verifier), 'hex').toString(
            'base64url',
          ),
          code_challenge_method: 'S256',
        });
        check();
        response.cookie(COMPANY_FLOW_COOKIE, flow, {
          ...cookieOptions,
          maxAge: 600000,
        });
        response.redirect(
          303,
          browser.authOrigin + '/company-session/authorize?' + query,
        );
        return;
      }
      if (path === '/company-session/logout') {
        const token = cookies.get(COMPANY_SESSION_COOKIE);
        if (!token) throw new CompanyBrowserError(401);
        const result = await this.privateCall(
          'revoke',
          { session_token: token },
          controller.signal,
        );
        check();
        if (
          Object.keys(result).join(',') !== 'revoked' ||
          result.revoked !== true
        )
          throw new CompanyBrowserError(503);
        response.cookie(COMPANY_SESSION_COOKIE, '', {
          ...cookieOptions,
          maxAge: 0,
        });
        response.cookie(COMPANY_FLOW_COOKIE, '', {
          ...cookieOptions,
          maxAge: 0,
        });
        response.status(200).json({ revoked: true });
        return;
      }
      let token = cookies.get(COMPANY_SESSION_COOKIE),
        expires = 0;
      if (path === '/company-session/callback') {
        const state = parameters.get('state')!;
        const verifier = openCompanyFlow(
          cookies.get(COMPANY_FLOW_COOKIE),
          state,
          configuration,
          browser,
        );
        const result = await this.privateCall(
          'token',
          {
            grant_type: 'authorization_code',
            code: parameters.get('code')!,
            redirect_uri: configuration.origin + '/company-session/callback',
            code_verifier: verifier,
            state_hash: stateHash(state),
          },
          controller.signal,
        );
        check();
        if (
          Object.keys(result).sort().join(',') !==
            'expires_in,session_token,token_type' ||
          typeof result.session_token !== 'string' ||
          !COMPANY_SESSION_TOKEN.test(result.session_token) ||
          result.token_type !== 'Bearer' ||
          !Number.isInteger(result.expires_in) ||
          Number(result.expires_in) < 1 ||
          Number(result.expires_in) > 900
        )
          throw new CompanyBrowserError(503);
        token = result.session_token;
        expires = Number(result.expires_in);
      }
      if (!token) throw new CompanyBrowserError(401);
      // Fresh central identity and exact current operator-bound native membership/role.
      await this.auth.authenticateSessionToken(token, controller.signal);
      check();
      if (path === '/company-session/callback') {
        response.cookie(COMPANY_SESSION_COOKIE, token, {
          ...cookieOptions,
          maxAge: expires * 1000,
        });
        response.cookie(COMPANY_FLOW_COOKIE, '', {
          ...cookieOptions,
          maxAge: 0,
        });
        response.redirect(
          303,
          configuration.origin + '/company-session/status',
        );
      } else response.status(200).json({ enabled: true, authenticated: true });
    } catch (error) {
      const status =
        error instanceof CompanyBrowserError
          ? error.status
          : error instanceof HttpException
            ? error.getStatus()
            : 503;
      if (!response.writableEnded && !response.destroyed)
        response.status(status).json({ error: 'company_session_unavailable' });
    } finally {
      clearTimeout(timer);
      request.removeListener('aborted', abort);
      response.removeListener('close', closed);
      if (admitted) this.active--;
    }
  }
}

export const companyBrowserIngress =
  (browser: CompanyBrowserService) =>
  (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> | void => {
    if (!browser.accepts(request)) {
      next();
      return;
    }
    return browser.handle(request, response);
  };
