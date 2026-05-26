// Stub: exe-os usage metering
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsageAnalyticsService {
  async getUsageBreakdown(_params: { workspaceId: string }) {
    return [];
  }

  async getAdminAiUsageByWorkspace(_params: {
    periodStart: Date;
    periodEnd: Date;
    useDollarMode?: boolean;
  }): Promise<Array<{ key: string; value: number; label?: string }>> {
    return [];
  }
}
