import { type Request } from 'express';

/**
 * Derive the request origin (`scheme://host`) used to resolve the caller's
 * tenant/workspace.
 *
 * Tenant binding MUST come from the verified request surface — not from a
 * global "first/oldest workspace" fallback — so every auth path that needs to
 * select a workspace resolves it from this origin via
 * `WorkspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace`.
 *
 * Precedence mirrors the rest of the Twenty auth stack:
 *   Origin header → X-Forwarded-Host → Host
 *
 * Returns `null` when no origin can be derived (e.g. unit tests that call a
 * controller method directly without a request object). Callers must treat a
 * `null`/unresolvable origin as "tenant unknown" and fail closed rather than
 * falling back to an arbitrary workspace.
 */
export const getRequestOrigin = (req: Request | undefined): string | null => {
  if (!req?.headers) {
    return null;
  }

  const originHeader = req.headers.origin;

  if (typeof originHeader === 'string' && originHeader.length > 0) {
    return originHeader;
  }

  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string' && forwardedHost.length > 0
      ? forwardedHost.split(',')[0]?.trim()
      : Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host;

  if (typeof host === 'string' && host.length > 0) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol =
      typeof forwardedProto === 'string' && forwardedProto.length > 0
        ? forwardedProto.split(',')[0]?.trim()
        : req.protocol || 'https';

    return `${protocol}://${host}`;
  }

  return null;
};
