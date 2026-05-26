// Stub: exe-os uses its own license server — always valid
import { Injectable } from '@nestjs/common';

@Injectable()
export class EnterprisePlanService {
  isValid(): boolean {
    return true;
  }

  hasValidEnterpriseKey(): boolean {
    return true;
  }

  hasValidSignedEnterpriseKey(): boolean {
    return true;
  }

  hasValidEnterpriseValidityToken(): boolean {
    return true;
  }
}
