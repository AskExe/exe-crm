import { type NextFunction, type Request, type Response } from 'express';

import { type CompanyAuthConfiguration } from './company-auth.config';
import { companyMcpEnabled } from '../company-mcp/company-mcp.config';
import { companyReadRoute } from './company-auth.policy';

export const companyAuthIngress =
  (configuration: CompanyAuthConfiguration) =>
  (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    const host = new URL(configuration.origin).host;
    const mcp = request.originalUrl === '/company-mcp' && companyMcpEnabled();
    if (mcp) {
      if (
        request.headers.origin &&
        request.headers.origin !== configuration.origin
      ) {
        response.status(403).json({ error: 'company_origin_denied' });
        return;
      }
      const counts = new Map<string, number>();
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index].toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const accept = request.headers.accept
        ?.split(',')
        .map((value) => value.trim());
      if (
        request.rawHeaders.length > 32 ||
        [...counts.values()].some((count) => count > 1) ||
        request.headers.host !== host ||
        request.headers.cookie ||
        request.headers['proxy-authorization'] ||
        request.headers['content-encoding'] ||
        request.headers['transfer-encoding'] ||
        request.headers.expect ||
        !['POST', 'GET', 'DELETE'].includes(request.method) ||
        (request.method === 'POST' &&
          (!/^application\/json(?:; charset=utf-8)?$/.test(
            request.headers['content-type'] ?? '',
          ) ||
            !accept?.includes('application/json') ||
            !accept.includes('text/event-stream') ||
            !/^[1-9][0-9]{0,3}$/.test(
              request.headers['content-length'] ?? '',
            ) ||
            Number(request.headers['content-length']) > 8192))
      ) {
        response.status(400).json({ error: 'company_request_invalid' });
        return;
      }
      next();
      return;
    }

    if (
      !companyReadRoute(request) ||
      request.headers.host !== host ||
      (request.headers.origin &&
        request.headers.origin !== configuration.origin) ||
      request.headers['transfer-encoding'] ||
      (request.headers['content-length'] &&
        request.headers['content-length'] !== '0')
    ) {
      response.status(403).json({ error: 'company_route_unavailable' });

      return;
    }
    // Fixed native context comes only from current private authority + local ACL.
    for (const name of Object.keys(request.headers)) {
      if (
        ![
          'host',
          'origin',
          'cookie',
          'authorization',
          'accept',
          'user-agent',
          'content-length',
        ].includes(name)
      ) {
        delete request.headers[name];
      }
    }
    next();
  };
