// Stub: exe-os uses GoTrue for auth, not upstream SSO
import { Module, Global } from '@nestjs/common';

import { SSOService } from './services/sso.service';

@Global()
@Module({
  providers: [SSOService],
  exports: [SSOService],
})
export class WorkspaceSSOModule {}
