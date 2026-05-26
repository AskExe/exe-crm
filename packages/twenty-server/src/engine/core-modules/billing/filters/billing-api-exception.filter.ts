// Stub: exe-os billing
import { Catch, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';

import { BillingException } from 'src/engine/core-modules/billing/billing.exception';

@Catch(BillingException)
export class BillingRestApiExceptionFilter implements ExceptionFilter {
  catch(_exception: BillingException, _host: ArgumentsHost) {
    // no-op stub
  }
}
