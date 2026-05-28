// Stub: exe-os uses its own license server for billing
import { Module, Global } from '@nestjs/common';

import { BillingService } from './services/billing.service';
import { BillingSubscriptionService } from './services/billing-subscription.service';

@Global()
@Module({
  providers: [BillingService, BillingSubscriptionService],
  exports: [BillingService, BillingSubscriptionService],
})
export class BillingModule {}
