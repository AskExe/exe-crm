// Stub: exe-os manages DNS externally
// @Global so every NestJS module can inject DnsManagerService without explicit import
import { Module, Global } from '@nestjs/common';

import { DnsManagerService } from './services/dns-manager.service';

@Global()
@Module({
  providers: [DnsManagerService],
  exports: [DnsManagerService],
})
export class DnsManagerModule {}
