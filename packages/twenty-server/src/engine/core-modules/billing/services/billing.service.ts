// Stub: exe-os uses its own license server for billing
import { Injectable } from '@nestjs/common';

@Injectable()
export class BillingService {
  isBillingEnabled(): boolean {
    return false;
  }

  async isSubscriptionIncompleteOnboardingStatus(
    _workspaceId: string,
  ): Promise<boolean> {
    return false;
  }

  async hasEntitlement(
    _workspaceId: string,
    _entitlementKey: string,
  ): Promise<boolean> {
    return true;
  }
}
