import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';

import { createHash, timingSafeEqual } from 'crypto';
import { type NextFunction, type Request, type Response } from 'express';

import {
  ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR,
  AdminTokenAuthFailureRateLimiter,
  getAdminTokenClientIp,
} from 'src/engine/core-modules/auth/utils/admin-token-auth-failure-rate-limiter.util';
import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { type FlatWorkspace } from 'src/engine/core-modules/workspace/types/flat-workspace.type';
import { getRequestOrigin } from 'src/utils/get-request-origin';

/** SHA-256 hash a string and return a Buffer for timingSafeEqual. */
const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

@Injectable()
export class AdminTokenMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AdminTokenMiddleware.name);
  private readonly adminTokenHash: Buffer | undefined;
  private readonly authFailureRateLimiter =
    new AdminTokenAuthFailureRateLimiter(10, 60_000);

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
    const clientIp = getAdminTokenClientIp(req);

    // Timing-safe comparison using SHA-256 hashes
    const incomingHash = sha256(token);

    if (
      incomingHash.length !== this.adminTokenHash.length ||
      !timingSafeEqual(incomingHash, this.adminTokenHash)
    ) {
      if (this.authFailureRateLimiter.consumeFailure(clientIp)) {
        this.logger.warn(
          `Admin token failed-auth rate limit exceeded for IP=${clientIp}`,
        );

        res.status(429).json({
          error: ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR,
        });

        return;
      }

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

    req.workspace = workspace as unknown as FlatWorkspace;
    req.workspaceId = workspace.id;
    req.adminTokenAuthenticated = true;

    this.logger.log(
      `Admin token accepted — IP=${clientIp} workspace=${workspace.id} path=${req.path}`,
    );

    next();
  }
}
