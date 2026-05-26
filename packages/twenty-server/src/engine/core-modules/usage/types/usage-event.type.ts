// Stub: exe-os usage metering
export type UsageEvent = {
  workspaceId: string;
  operationType: string;
  resourceType: string;
  unit: string;
  amount: number;
};
