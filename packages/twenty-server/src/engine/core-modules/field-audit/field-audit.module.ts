import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { FieldAuditLogEntity } from 'src/engine/core-modules/field-audit/field-audit.entity';
import { FieldAuditService } from 'src/engine/core-modules/field-audit/field-audit.service';

@Module({
  imports: [TypeORMModule, TypeOrmModule.forFeature([FieldAuditLogEntity])],
  providers: [FieldAuditService],
  exports: [FieldAuditService],
})
export class FieldAuditModule {}
