// Stub: exe-os usage metering
export type UsageEvent = {
  workspaceId?: string;
  operationType: string;
  resourceType: string;
  unit: string;
  quantity?: number;
  amount?: number;
  creditsUsedMicro?: number;
  resourceId?: string | null;
  resourceContext?: string | null;
  userWorkspaceId?: string | null;
};
