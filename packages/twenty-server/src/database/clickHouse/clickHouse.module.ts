import { Module } from '@nestjs/common';

import { TwentyConfigModule } from 'src/engine/core-modules/twenty-config/twenty-config.module';

import { ClickHouseService } from './clickHouse.service';
import { ClickHouseTableInitService } from './clickHouse-table-init.service';

@Module({
  imports: [TwentyConfigModule],
  providers: [ClickHouseService, ClickHouseTableInitService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
