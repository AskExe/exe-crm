// Stub: exe-os manages DNS externally
import { Injectable } from '@nestjs/common';

import { type DomainValidRecords } from 'src/engine/core-modules/dns-manager/dtos/domain-valid-records';

@Injectable()
export class DnsManagerService {
  async refreshHostname(_hostname: string): Promise<DomainValidRecords> {
    return { records: [] };
  }

  async deleteHostnameSilently(_hostname: string): Promise<void> {
    // no-op
  }
}
