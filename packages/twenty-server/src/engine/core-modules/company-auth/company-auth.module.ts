import { Module } from '@nestjs/common';

import { UserVarsModule } from 'src/engine/core-modules/user/user-vars/user-vars.module';

import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

import { CompanyBrowserService } from './company-browser.service';

import { CompanyAuthService } from './company-auth.service';

@Module({
  imports: [WorkspaceCacheModule, UserVarsModule],
  providers: [CompanyAuthService, CompanyBrowserService],
  exports: [CompanyAuthService, CompanyBrowserService],
})
export class CompanyAuthModule {}
