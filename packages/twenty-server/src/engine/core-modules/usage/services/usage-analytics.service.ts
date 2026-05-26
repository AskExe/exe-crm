// Stub: exe-os usage metering
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsageAnalyticsService {
  async getUsageBreakdown(_params: {
    workspaceId: string;
  }) {
    return [];
  }
}
