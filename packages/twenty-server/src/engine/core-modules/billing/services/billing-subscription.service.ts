// Stub: exe-os uses its own license server for billing
import { Injectable } from '@nestjs/common';

@Injectable()
export class BillingSubscriptionService {
  async getBillingSubscriptions(_workspaceId: string) {
    return [];
  }

  async getCurrentBillingSubscription(_params: { workspaceId: string }) {
    return undefined;
  }

  async getWorkspaceEntitlements(_workspaceId: string) {
    return [];
  }

  async deleteSubscriptions(_workspaceId: string) {
    return;
  }
}
