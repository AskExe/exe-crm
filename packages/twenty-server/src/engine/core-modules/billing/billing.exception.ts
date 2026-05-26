// Stub: exe-os billing
export class BillingException extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export enum BillingExceptionCode {
  BILLING_PRODUCT_NOT_FOUND = 'BILLING_PRODUCT_NOT_FOUND',
  BILLING_CUSTOMER_NOT_FOUND = 'BILLING_CUSTOMER_NOT_FOUND',
  BILLING_SUBSCRIPTION_NOT_FOUND = 'BILLING_SUBSCRIPTION_NOT_FOUND',
  METERED_PRODUCT_USAGE_LIMIT_REACHED = 'METERED_PRODUCT_USAGE_LIMIT_REACHED',
}
