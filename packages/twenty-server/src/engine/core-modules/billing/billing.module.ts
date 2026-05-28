// Stub: exe-os uses its own license server for billing
// All billing services are no-op stubs. BillingModule is @Global so every
// NestJS module can inject any billing service without explicit imports.
import { Module, Global } from '@nestjs/common';

import { BillingService } from './services/billing.service';
import { BillingSubscriptionService } from './services/billing-subscription.service';
import { BillingUsageService } from './services/billing-usage.service';
import { StripeSdkService, STRIPE_SDK_SERVICE } from './stripe/stripe-sdk/services/stripe-sdk.service';

@Global()
@Module({
  providers: [
    BillingService,
    BillingSubscriptionService,
    BillingUsageService,
    { provide: STRIPE_SDK_SERVICE, useClass: StripeSdkService },
    StripeSdkService,
  ],
  exports: [
    BillingService,
    BillingSubscriptionService,
    BillingUsageService,
    STRIPE_SDK_SERVICE,
    StripeSdkService,
  ],
})
export class BillingModule {}
