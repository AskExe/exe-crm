import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'crypto';
import { type NextFunction, type Request, type Response } from 'express';

import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { getRequestOrigin } from 'src/utils/get-request-origin';

/** SHA-256 hash a string and return a Buffer for timingSafeEqual. */
const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

/** Simple in-memory sliding-window rate limiter (per IP). */
class AdminTokenRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;

  constructor(maxAttempts = 10, windowMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);

    this.attempts.set(ip, recent);

    return recent.length >= this.maxAttempts;
  }

  record(ip: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(ip) ?? [];

    timestamps.push(now);
    this.attempts.set(ip, timestamps);
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

  async use(req: Request, _res: Response, next: NextFunction) {
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
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    // Rate-limit check before any comparison
    if (this.rateLimiter.isRateLimited(clientIp)) {
      this.logger.warn(`Admin token rate limit exceeded for IP=${clientIp}`);

      next();

      return;
    }

    this.rateLimiter.record(clientIp);

    // Timing-safe comparison using SHA-256 hashes
    const incomingHash = sha256(token);

    if (
      incomingHash.length !== this.adminTokenHash.length ||
      !timingSafeEqual(incomingHash, this.adminTokenHash)
    ) {
      this.logger.warn(
        `Admin token rejected — IP=${clientIp} path=${req.path}`,
      );

      next();

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
