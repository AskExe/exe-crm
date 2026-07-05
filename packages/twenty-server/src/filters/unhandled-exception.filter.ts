import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';

import { type Request, type Response } from 'express';

import { WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { isOriginAllowed } from 'src/utils/cors/is-origin-allowed.util';

// In case of exception in middleware run before the CORS middleware (eg: JSON Middleware that checks the request body),
// the CORS headers are missing in the response.
// This class add CORS headers to exception response to avoid misleading CORS error
@Catch()
export class UnhandledExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceDomainsService: WorkspaceDomainsService,
  ) {}

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  async catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    if (!response.header || response.headersSent) {
      return;
    }

    const originHeader =
      typeof request.headers.origin === 'string'
        ? request.headers.origin
        : undefined;

    if (
      originHeader &&
      (await isOriginAllowed({
        origin: originHeader,
        twentyConfigService: this.twentyConfigService,
        workspaceDomainsService: this.workspaceDomainsService,
      }))
    ) {
      response.header(
        'Access-Control-Allow-Origin',
        new URL(originHeader).origin,
      );
      response.header('Access-Control-Allow-Credentials', 'true');
      response.header('Vary', 'Origin');
      response.header(
        'Access-Control-Allow-Methods',
        'GET,HEAD,PUT,PATCH,POST,DELETE',
      );
      response.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Schema-Version, X-App-Version, x-locale, X-Agent-Id, X-Agent-Role, X-Webhook-Signature',
      );
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    // Never leak internal error details (stack traces, DB URLs) to clients.
    // HttpException responses are safe (controlled by our code).
    // Non-HttpException (500) errors are sanitized to prevent info disclosure.
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal Server Error' };

    response.status(status).json(body);
  }
}
