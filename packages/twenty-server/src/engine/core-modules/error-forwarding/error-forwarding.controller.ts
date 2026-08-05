import {
  Body,
  Controller,
  HttpCode,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { ErrorReportDto } from './dtos/error-report.dto';
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
