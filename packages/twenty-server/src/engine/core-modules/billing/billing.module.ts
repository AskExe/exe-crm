// Stub: exe-os uses its own license server for billing.
// All services are no-op stubs so NestJS DI resolves everywhere.
import { Module, Global } from '@nestjs/common';

import { BillingService } from './services/billing.service';
import { BillingSubscriptionService } from './services/billing-subscription.service';
import { BillingUsageService } from './services/billing-usage.service';
import { UpdateSubscriptionQuantityJob } from './jobs/update-subscription-quantity.job';
import {
  StripeSdkService,
  STRIPE_SDK_SERVICE,
} from './stripe/stripe-sdk/services/stripe-sdk.service';

const allProviders = [
  BillingService,
  BillingSubscriptionService,
  BillingUsageService,
  UpdateSubscriptionQuantityJob,
  StripeSdkService,
  { provide: STRIPE_SDK_SERVICE, useClass: StripeSdkService },
];

@Global()
@Module({
  providers: allProviders,
  exports: allProviders,
})
export class BillingModule {}
