// Stub: exe-os uses its own license server
import { Module, Global } from '@nestjs/common';

import { EnterprisePlanService } from './services/enterprise-plan.service';

@Global()
@Module({
  providers: [EnterprisePlanService],
  exports: [EnterprisePlanService],
})
export class EnterpriseModule {}
