// Stub: exe-os manages DNS externally
import { Module, Global } from '@nestjs/common';

import { DnsManagerService } from './services/dns-manager.service';

@Global()
@Module({
  providers: [DnsManagerService],
  exports: [DnsManagerService],
})
export class DnsManagerModule {}
