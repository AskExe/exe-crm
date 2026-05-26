// Stub: exe-os billing (no Stripe)
import { Injectable } from '@nestjs/common';

export const STRIPE_SDK_SERVICE = 'STRIPE_SDK_SERVICE';

@Injectable()
export class StripeSdkService {}

// Legacy alias
export const StripeSDKService = StripeSdkService;
export type StripeSDKService = StripeSdkService;
