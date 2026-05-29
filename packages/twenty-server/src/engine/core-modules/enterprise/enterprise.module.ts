// Stub: exe-os uses its own license server
// @Global so any module can inject without explicit import
import { Module, Global } from '@nestjs/common';

import { EnterprisePlanService } from './services/enterprise-plan.service';

@Global()
@Module({
  providers: [EnterprisePlanService],
  exports: [EnterprisePlanService],
})
export class EnterpriseModule {}
