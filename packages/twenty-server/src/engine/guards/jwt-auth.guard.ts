import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { bindDataToRequestObject } from 'src/engine/utils/bind-data-to-request-object.util';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceStorageCacheService: WorkspaceCacheStorageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Admin token bypass — already validated and hydrated by AdminTokenMiddleware.
    if (request.adminTokenAuthenticated) {
      return true;
    }

    // GoTrue JWT — shared auth layer across all exe-os services.
    // If GOTRUE_URL is configured, validate the Bearer token against GoTrue.
    // This enables one-login across CRM, Wiki, and Gateway.
    const gotrueUrl = process.env.GOTRUE_URL || process.env.EXE_GOTRUE_URL;
    if (gotrueUrl) {
      const authHeader = request.headers?.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearerToken) {
        try {
          const res = await fetch(`${gotrueUrl}/user`, {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            const gotrueUser = await res.json();
            if (gotrueUser?.id) {
              request.gotrueUser = gotrueUser;
              this.logger.debug(`GoTrue auth: ${gotrueUser.email ?? gotrueUser.id}`);
              return true;
            }
          }
        } catch (err) {
          this.logger.debug(`GoTrue validation failed, falling through to Twenty auth: ${err}`);
        }
      }
    }

    try {
      const data =
        await this.accessTokenService.validateTokenByRequest(request);
      const metadataVersion = data.workspace
        ? await this.workspaceStorageCacheService.getMetadataVersion(
            data.workspace.id,
          )
        : undefined;

      if (
        !isDefined(data.apiKey) &&
        !isDefined(data.userWorkspaceId) &&
        !isDefined(data.application)
      ) {
        this.logger.warn(
          `Auth failed: no apiKey, userWorkspaceId, or application in context`,
        );

        return false;
      }

      bindDataToRequestObject(data, request, metadataVersion);

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.warn(`Auth failed: ${errorMessage}`);

      return false;
    }
  }
}
