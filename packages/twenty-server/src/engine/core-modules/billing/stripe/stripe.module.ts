// Stub: exe-os billing (no Stripe)
// @Global so jobs module can inject without explicit import
import { Module, Global } from '@nestjs/common';

@Global()
@Module({})
export class StripeModule {}
