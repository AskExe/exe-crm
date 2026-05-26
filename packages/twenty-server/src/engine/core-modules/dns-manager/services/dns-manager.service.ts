// Stub: exe-os manages DNS externally
import { Injectable } from '@nestjs/common';

import { type DomainValidRecords } from 'src/engine/core-modules/dns-manager/dtos/domain-valid-records';

@Injectable()
export class DnsManagerService {
  async refreshHostname(
    _hostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<DomainValidRecords> {
    return { records: [] };
  }

  async deleteHostnameSilently(
    _hostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<void> {
    // no-op
  }

  async registerHostname(
    _hostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<void> {
    // no-op
  }

  async updateHostname(
    _oldHostname: string,
    _newHostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<void> {
    // no-op
  }

  async getHostnameWithRecords(
    _hostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<DomainValidRecords | null> {
    return null;
  }

  async isHostnameWorking(
    _hostname: string,
    _options?: { isPublicDomain?: boolean },
  ): Promise<boolean> {
    return false;
  }
}
