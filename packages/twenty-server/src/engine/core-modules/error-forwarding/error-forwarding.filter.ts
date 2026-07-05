import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { type Request, type Response } from 'express';

import { ErrorForwardingService } from './error-forwarding.service';

// Global exception filter that forwards 5xx errors to exe-monitor-hub.
// Applied alongside the existing UnhandledExceptionFilter via APP_FILTER.
// This filter only forwards — it does NOT modify the response.
@Injectable()
@Catch()
export class ErrorForwardingFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorForwardingFilter.name);

  constructor(
    private readonly errorForwardingService: ErrorForwardingService,
  ) {}

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    // Only forward 5xx server errors
    if (status >= 500) {
      const message =
        exception instanceof Error ? exception.message : String(exception);
      const stack =
        exception instanceof Error ? (exception.stack ?? null) : null;

      const userId =
        // The workspace auth middleware attaches user to request
        (request as unknown as Record<string, unknown>)?.['user']?.toString() ??
        '';

      this.errorForwardingService.forwardBackendError({
        message,
        stack,
        url: request.originalUrl ?? request.url ?? '',
        method: request.method ?? 'UNKNOWN',
        statusCode: status,
        userId,
        metadata: {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
    }

    // Re-throw so the existing exception pipeline handles the response
    // (NestJS will call the next filter in the chain)
    if (!response.headersSent) {
      const body =
        exception instanceof HttpException
          ? exception.getResponse()
          : { statusCode: status, message: 'Internal Server Error' };

      response.status(status).json(body);
    }
  }
}
