import { Module } from '@nestjs/common';

import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

import { CompanyBrowserService } from './company-browser.service';

import { CompanyAuthService } from './company-auth.service';

@Module({
  imports: [WorkspaceCacheModule],
  providers: [CompanyAuthService, CompanyBrowserService],
  exports: [CompanyAuthService, CompanyBrowserService],
})
export class CompanyAuthModule {}
