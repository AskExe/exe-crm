import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

import { ErrorReportDto } from './dtos/error-report.dto';
import { ErrorForwardingService } from './error-forwarding.service';

// Receives frontend error reports and proxies them to exe-monitor-hub.
// Endpoint: POST /api/errors
@Controller('api/errors')
export class ErrorForwardingController {
  constructor(
    private readonly errorForwardingService: ErrorForwardingService,
  ) {}

  // Public by design: frontend error reports must be accepted even when the
  // user is not (or no longer) authenticated — e.g. crashes on the sign-in
  // page. The payload is validated below and only proxied to exe-monitor-hub;
  // nothing is read from or written to workspace data.
  @Post()
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  @HttpCode(202)
  // Validate shape/types but stay permissive: `whitelist: false` keeps any
  // extra fields a future monitor client might add, so this only rejects
  // genuinely malformed payloads without breaking the forwarding contract.
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  )
  receiveError(@Body() body: ErrorReportDto): { accepted: boolean } {
    this.errorForwardingService.forwardFrontendError(body);

    return { accepted: true };
  }
}
