import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { ErrorForwardingService } from './error-forwarding.service';

// Receives frontend error reports and proxies them to exe-monitor-hub.
// Endpoint: POST /api/errors
@Controller('api/errors')
export class ErrorForwardingController {
  constructor(
    private readonly errorForwardingService: ErrorForwardingService,
  ) {}

  @Post()
  @HttpCode(202)
  receiveError(
    @Body()
    body: {
      service: string;
      level: 'error' | 'fatal' | 'warn';
      type: 'frontend' | 'backend';
      message: string;
      stack: string | null;
      url: string;
      method: string;
      status_code: number;
      user_id: string;
      release: string;
      timestamp: string;
      metadata: Record<string, unknown>;
    },
  ): { accepted: boolean } {
    this.errorForwardingService.forwardFrontendError(body);

    return { accepted: true };
  }
}
