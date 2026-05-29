// Stub: exe-os uses GoTrue for auth, not upstream SSO
// @Global so auth modules can inject without explicit import
import { Module, Global } from '@nestjs/common';

import { SSOService } from './services/sso.service';

@Global()
@Module({
  providers: [SSOService],
  exports: [SSOService],
})
export class WorkspaceSSOModule {}
