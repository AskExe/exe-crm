// Exe installation licenses authorize features; upstream billing stays disabled.
import { Injectable } from '@nestjs/common';

import { readExeLicense } from 'src/engine/core-modules/enterprise/services/exe-license-authority';

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
    return (await readExeLicense()) !== null;
  }

  async canBillMeteredProduct(
    _workspaceId: string,
    _productKey: string,
  ): Promise<boolean> {
    return (await readExeLicense()) !== null;
  }
}
