// Stub: exe-os uses its own API Router for usage metering
import { Module, Global } from '@nestjs/common';

import { UsageAnalyticsService } from './services/usage-analytics.service';

@Global()
@Module({
  providers: [UsageAnalyticsService],
  exports: [UsageAnalyticsService],
})
export class UsageModule {}
