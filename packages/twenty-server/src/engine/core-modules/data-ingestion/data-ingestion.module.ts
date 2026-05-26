import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TypeORMModule } from 'src/database/typeorm/typeorm.module';
import { DataIngestionController } from 'src/engine/core-modules/data-ingestion/data-ingestion.controller';
import { DataIngestionService } from 'src/engine/core-modules/data-ingestion/data-ingestion.service';
import { DataProvenanceEntity } from 'src/engine/core-modules/data-ingestion/data-provenance.entity';
import { FieldAuditModule } from 'src/engine/core-modules/field-audit/field-audit.module';

@Module({
  imports: [
    TypeORMModule,
    TypeOrmModule.forFeature([DataProvenanceEntity]),
    FieldAuditModule,
  ],
  controllers: [DataIngestionController],
  providers: [DataIngestionService],
  exports: [DataIngestionService],
})
export class DataIngestionModule {}
