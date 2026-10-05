import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { companyAuthEnabled } from 'src/engine/core-modules/company-auth/company-auth.config';

import { readExeLicense } from './exe-license-authority';

@Injectable()
export class EnterprisePlanService {
  async isValid(): Promise<boolean> {
    // Company read access uses current technical + subscription authority.
    // No unreviewed enterprise feature or legacy cloud activation is enabled.
    if (companyAuthEnabled()) return false;

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
