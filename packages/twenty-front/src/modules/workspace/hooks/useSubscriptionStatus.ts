import { type SubscriptionStatus } from '~/generated-metadata/graphql';

// Billing is stripped from our fork — always returns undefined
export const useSubscriptionStatus = (): SubscriptionStatus | undefined => {
  return undefined;
};
