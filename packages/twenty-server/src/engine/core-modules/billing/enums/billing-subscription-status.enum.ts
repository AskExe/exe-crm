// Stub: exe-os billing
export enum BillingSubscriptionStatus {
  Active = 'active',
  Canceled = 'canceled',
  Incomplete = 'incomplete',
  IncompleteExpired = 'incomplete_expired',
  PastDue = 'past_due',
  Trialing = 'trialing',
  Unpaid = 'unpaid',
}

// Legacy alias
export const SubscriptionStatus = BillingSubscriptionStatus;
export type SubscriptionStatus = BillingSubscriptionStatus;

