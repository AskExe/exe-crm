import { join } from 'node:path';

import {
  static as serveStatic,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { type CompanyAuthConfiguration } from './company-auth.config';
import { companyAuthIngress } from './company-auth.ingress';
import { companyCredential, companyReadRoute } from './company-auth.policy';

// Transport admission precedes AdminTokenMiddleware. Resolver capabilities and
// live native ACLs provide the separate operation-level authority check.
export const companyEditorIngress = (
  configuration: CompanyAuthConfiguration,
  compiledFront: string,
) => {
  const assets = serveStatic(compiledFront, {
    dotfiles: 'deny',
    index: false,
    redirect: false,
  });
  const reader = companyAuthIngress(configuration);
  return (request: Request, response: Response, next: NextFunction): void => {
    const deny = () => {
      response.status(403).json({ error: 'company_route_unavailable' });
    };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (companyReadRoute(request)) {
      reader(request, response, next);
      return;
    }
    if (
      request.headers.host !== new URL(configuration.origin).host ||
      (request.headers.origin &&
        request.headers.origin !== configuration.origin) ||
      request.originalUrl.length > 2048 ||
      /[%\\\x00-\x20\x7f]/.test(request.originalUrl) ||
      request.headers.authorization ||
      request.headers['proxy-authorization'] ||
      request.headers.upgrade ||
      request.headers['content-encoding'] ||
      request.headers.expect
    ) {
      deny();
      return;
    }
    const names = new Set<string>();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index].toLowerCase();
      if (
        names.has(name) ||
        /^(?:x-(?:auth|frappe|workspace|user|company|org|role)|forwarded)/.test(
          name,
        )
      ) {
        deny();
        return;
      }
      names.add(name);
    }
    if (request.rawHeaders.length > 64) {
      deny();
      return;
    }
    if (['/graphql', '/metadata'].includes(request.originalUrl)) {
      try {
        if (companyCredential(request).kind !== 'session') {
          deny();
          return;
        }
      } catch {
        deny();
        return;
      }
      if (
        request.method !== 'POST' ||
        !/^application\/json(?:; charset=utf-8)?$/.test(
          request.headers['content-type'] ?? '',
        ) ||
        !/^[1-9][0-9]{0,5}$/.test(request.headers['content-length'] ?? '') ||
        Number(request.headers['content-length']) > 262144 ||
        request.headers['transfer-encoding'] ||
        request.headers['sec-fetch-site'] !== 'same-origin'
      ) {
        deny();
        return;
      }
      next();
      return;
    }
    // Existing native bootstrap configuration is public; no auth/controller
    // route may fall through to Nest or become an SPA success response.
    if (request.originalUrl === '/client-config' && request.method === 'GET') {
      next();
      return;
    }
    const path = request.originalUrl.split('?')[0];
    if (
      request.method !== 'GET' ||
      /^\/(?:api|auth|rest|graphql|metadata|client-config|company-session|company-mcp|upload|files|health|healthz|metrics)(?:\/|$)/.test(
        path,
      ) ||
      path
        .split('/')
        .some((component) => component === '..' || component.startsWith('.'))
    ) {
      deny();
      return;
    }
    assets(request, response, (error?: unknown) => {
      if (error || /\.[^/]+$/.test(path)) {
        deny();
        return;
      }
      response.sendFile(join(compiledFront, 'index.html'), (failure) => {
        if (failure && !response.headersSent) response.status(404).end();
      });
    });
  };
};
