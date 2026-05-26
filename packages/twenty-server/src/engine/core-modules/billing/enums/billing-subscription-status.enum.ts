// Stub: exe-os billing
export enum BillingSubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
  PAST_DUE = 'past_due',
  TRIALING = 'trialing',
  UNPAID = 'unpaid',
}

// Legacy alias
export const SubscriptionStatus = BillingSubscriptionStatus;
export type SubscriptionStatus = BillingSubscriptionStatus;

