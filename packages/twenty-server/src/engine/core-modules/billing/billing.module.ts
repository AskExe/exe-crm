// Stub: exe-os uses its own license server for billing
import { Module, Global } from '@nestjs/common';

import { BillingService } from './services/billing.service';

@Global()
@Module({
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
