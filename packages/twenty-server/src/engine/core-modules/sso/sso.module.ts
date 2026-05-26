// Stub: exe-os uses GoTrue for auth, not upstream SSO
import { Module } from '@nestjs/common';

import { SSOService } from './services/sso.service';

@Module({
  providers: [SSOService],
  exports: [SSOService],
})
export class WorkspaceSSOModule {}
