import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { readExeLicense } from './exe-license-authority';

@Injectable()
export class EnterprisePlanService {
  async isValid(): Promise<boolean> {
    return (await readExeLicense())?.plan === 'enterprise';
  }

  // These GraphQL display flags also appear on the public sign-in page.
  // An outage hides enterprise affordances without preventing basic login;
  // actual feature guards use isValid(), which preserves the retryable error.
  private async publicValidityFlag(): Promise<boolean> {
    try {
      return await this.isValid();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) return false;
      throw error;
    }
  }

  hasValidEnterpriseKey(): Promise<boolean> {
    return this.publicValidityFlag();
  }

  hasValidSignedEnterpriseKey(): Promise<boolean> {
    return this.publicValidityFlag();
  }

  hasValidEnterpriseValidityToken(): Promise<boolean> {
    return this.publicValidityFlag();
  }
}
