// Stub: exe-os uses its own usage metering via API Router
import { Injectable } from '@nestjs/common';

@Injectable()
export class BillingUsageService {
  async trackUsage(_params: {
    workspaceId: string;
    productKey: string;
    quantity?: number;
  }) {
    return;
  }
}
