import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'crypto';
import { type NextFunction, type Request, type Response } from 'express';

import { isAdminTokenLoginEnabled } from 'src/engine/core-modules/auth/utils/is-admin-token-login-enabled.util';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { getRequestOrigin } from 'src/utils/get-request-origin';
import { getTrustedClientIp } from 'src/utils/get-trusted-client-ip';

/** SHA-256 hash a string and return a Buffer for timingSafeEqual. */
const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

/**
 * Is this bearer token a JWT — i.e. an ORDINARY session token rather than an
 * attempt to use the static admin secret?
 *
 * Every authenticated caller of this API (the CRM SPA, the mobile client, the
 * REST/MCP integrations, the GoTrue bridge) sends a three-segment JWS in
 * `Authorization: Bearer`. `EXE_CRM_ADMIN_TOKEN` is an opaque high-entropy
 * secret and is never shaped like one. Discriminating on shape is what lets the
 * middleware tell "somebody is guessing the admin secret" apart from "a user is
 * loading their inbox", which it previously could not do at all (bug 29837293).
 *
 * A false positive here is harmless: a JWT-shaped guess is simply not counted.
 * A false NEGATIVE is what broke production, so the test is deliberately loose.
 */
const looksLikeJwt = (token: string): boolean =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token);

/** How many distinct keys the limiter will track before it sheds the oldest. */
const MAX_TRACKED_KEYS = 10_000;

/** Simple in-memory sliding-window rate limiter, keyed on a trusted peer. */
class AdminTokenRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 10, windowMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private prune(key: string, now: number): number[] {
    const recent = (this.attempts.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    if (recent.length === 0) {
      this.attempts.delete(key);
    } else {
      this.attempts.set(key, recent);
    }

    return recent;
  }

  isRateLimited(key: string): boolean {
    return this.prune(key, Date.now()).length >= this.maxAttempts;
  }

  getRetryAfterSeconds(key: string): number {
    const now = Date.now();
    const oldest = this.prune(key, now)[0];

    if (oldest === undefined) {
      return Math.ceil(this.windowMs / 1000);
    }

    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
  }

  record(key: string): void {
    const now = Date.now();
    const recent = this.prune(key, now);

    recent.push(now);
    this.attempts.set(key, recent);

    // Bound the map. Without this, a peer that varies its key grows the process
    // heap without limit. Map iteration order is insertion order, so the first
    // key is the least recently created.
    while (this.attempts.size > MAX_TRACKED_KEYS) {
      const oldestKey = this.attempts.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.attempts.delete(oldestKey);
    }
  }
}

@Injectable()
export class AdminTokenMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminTokenMiddleware.name);
  private readonly adminTokenHash: Buffer | undefined;
  private readonly rateLimiter = new AdminTokenRateLimiter(10, 60_000);

  constructor(
    private readonly workspaceDomainsService: WorkspaceDomainsService,
  ) {
    const raw = process.env.EXE_CRM_ADMIN_TOKEN;

    if (raw) {
      this.adminTokenHash = sha256(raw);
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.adminTokenHash) {
      next();

      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      next();

      return;
    }

    const token = authHeader.slice(7);

    // ── FIX (bug 29837293) — ordinary user tokens are not admin attempts ─────
    // This middleware is mounted on /graphql, /metadata, /rest/* and /mcp, i.e.
    // on EVERY authenticated request the product makes. Previously any bearer
    // token that was not the admin secret was recorded as a failed admin-token
    // attempt and counted against a 10-per-minute-per-IP budget, so a single
    // CRM page load exhausted the budget and every subsequent request — data,
    // metadata, workflows — was refused with 429 before reaching a resolver.
    // Behind Cloudflare and exe-sso-edge the budget was shared, so ten requests
    // from anyone locked out everyone on that hop.
    //
    // A JWT is never an admin-token attempt. Let it past untouched: no
    // comparison, no bookkeeping, and above all no 429 for a caller that was
    // not trying to authenticate as admin in the first place.
    if (looksLikeJwt(token)) {
      next();

      return;
    }

    // Only genuine admin-token attempts (opaque, non-JWT bearer secrets) reach
    // the limiter, and the key is derived from a trusted hop rather than from
    // the raw first X-Forwarded-For entry — which the caller controls, and
    // which therefore let an attacker rotate out of the window at will while
    // real users were bucketed together. See get-trusted-client-ip.ts.
    const { ip: clientIp, isShared, source } = getTrustedClientIp(req);

    if (this.rateLimiter.isRateLimited(clientIp)) {
      this.logger.warn(
        `Admin token rate limit exceeded for IP=${clientIp} (source=${source}${
          isShared ? ', shared' : ''
        })`,
      );

      res.setHeader(
        'Retry-After',
        this.rateLimiter.getRetryAfterSeconds(clientIp).toString(),
      );
      res.status(429).json({
        error: 'rate_limit_exceeded',
        error_description:
          'Too many failed admin token attempts, please try again later',
      });

      return;
    }

    // Timing-safe comparison using SHA-256 hashes
    const incomingHash = sha256(token);

    if (
      incomingHash.length !== this.adminTokenHash.length ||
      !timingSafeEqual(incomingHash, this.adminTokenHash)
    ) {
      this.rateLimiter.record(clientIp);

      this.logger.warn(
        `Admin token rejected — IP=${clientIp} path=${req.path}`,
      );

      next();

      return;
    }

    // ── FIX (admin-token backdoor) — fail closed ──────────────────────────────
    // The token matched, but the static-secret admin path is disabled for this
    // deployment: MANAGED (`EXE_ORG_ID` set) never permits a static-secret
    // owner-impersonation backdoor, and unmanaged deployments must opt in with
    // `ENABLE_ADMIN_TOKEN_LOGIN=true`. Refuse with 401 rather than granting an
    // owner session.
    if (!isAdminTokenLoginEnabled()) {
      this.logger.warn(
        `Admin token presented but disabled — IP=${clientIp} path=${req.path}`,
      );

      res.status(401).json({ error: 'Authentication failed' });

      return;
    }

    // Bind the admin-token context to the tenant derived from the request
    // origin (subdomain / custom domain), or the single default workspace in
    // single-workspace deployments. Never select a global first/oldest
    // workspace — that would attach admin context to an arbitrary tenant.
    const origin = getRequestOrigin(req);
    const workspace = origin
      ? await this.workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
          origin,
        )
      : null;

    if (!workspace) {
      this.logger.warn(
        `Admin token accepted but no tenant resolved for origin=${origin ?? 'unknown'} path=${req.path} — passing through unauthenticated`,
      );

      next();

      return;
    }

    req.workspace = workspace as any;
    req.workspaceId = workspace.id;
    req.adminTokenAuthenticated = true;

    this.logger.log(
      `Admin token accepted — IP=${clientIp} workspace=${workspace.id} path=${req.path}`,
    );

    next();
  }
}
