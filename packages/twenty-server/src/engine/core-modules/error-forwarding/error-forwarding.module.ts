import { Module } from '@nestjs/common';

import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';

import { ErrorForwardingController } from './error-forwarding.controller';
import { ErrorForwardingFilter } from './error-forwarding.filter';
import { ErrorForwardingService } from './error-forwarding.service';

@Module({
  imports: [TwentyConfigModule],
  controllers: [ErrorForwardingController],
  providers: [ErrorForwardingService, ErrorForwardingFilter],
  exports: [ErrorForwardingService, ErrorForwardingFilter],
})
export class ErrorForwardingModule {}
