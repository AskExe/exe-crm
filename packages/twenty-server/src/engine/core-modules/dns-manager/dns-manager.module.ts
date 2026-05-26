// Stub: exe-os manages DNS externally
import { Module } from '@nestjs/common';

import { DnsManagerService } from './services/dns-manager.service';

@Module({
  providers: [DnsManagerService],
  exports: [DnsManagerService],
})
export class DnsManagerModule {}
