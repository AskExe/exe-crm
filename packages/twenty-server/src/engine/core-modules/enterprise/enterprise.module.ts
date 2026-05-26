// Stub: exe-os uses its own license server
import { Module } from '@nestjs/common';

import { EnterprisePlanService } from './services/enterprise-plan.service';

@Module({
  providers: [EnterprisePlanService],
  exports: [EnterprisePlanService],
})
export class EnterpriseModule {}
