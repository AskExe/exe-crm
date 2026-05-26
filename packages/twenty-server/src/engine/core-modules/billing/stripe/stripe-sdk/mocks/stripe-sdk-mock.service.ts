// Stub: exe-os billing (no Stripe)
import { Injectable } from '@nestjs/common';

@Injectable()
export class StripeSdkMockService {}

// Legacy alias
export const StripeSDKMockService = StripeSdkMockService;
export type StripeSDKMockService = StripeSdkMockService;
