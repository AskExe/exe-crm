// Stub: exe-os uses GoTrue for auth, not Twenty SSO
import { Module } from '@nestjs/common';

import { SSOService } from './services/sso.service';

@Module({
  providers: [SSOService],
  exports: [SSOService],
})
export class WorkspaceSSOModule {}
