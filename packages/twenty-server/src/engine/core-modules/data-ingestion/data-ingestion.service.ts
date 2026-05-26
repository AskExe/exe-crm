import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { DataProvenanceEntity } from 'src/engine/core-modules/data-ingestion/data-provenance.entity';
import {
  type IngestError,
  type IngestRecordDto,
  type IngestResult,
} from 'src/engine/core-modules/data-ingestion/data-ingestion.dto';
import { FieldAuditService } from 'src/engine/core-modules/field-audit/field-audit.service';

@Injectable()
export class DataIngestionService {
  private readonly logger = new Logger(DataIngestionService.name);

  constructor(
    @InjectRepository(DataProvenanceEntity)
    private readonly dataProvenanceRepository: Repository<DataProvenanceEntity>,
    private readonly fieldAuditService: FieldAuditService,
  ) {}

  async ingestRecords(
    workspaceId: string,
    records: IngestRecordDto[],
    source: string,
    userId: string,
  ): Promise<IngestResult> {
    const result: IngestResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        await this.processRecord(
          workspaceId,
          record,
          source,
          userId,
          i,
          result,
        );
      } catch (error) {
        const errorEntry: IngestError = {
          index: i,
          objectName: record.objectName,
          message:
            error instanceof Error ? error.message : 'Unknown ingestion error',
          rawEventId: record.rawEventId,
        };

        result.errors.push(errorEntry);

        this.logger.warn(
          `Ingestion error at index ${i} for ${record.objectName}: ${errorEntry.message}`,
        );
      }
    }

    this.logger.log(
      `Ingestion complete for workspace ${workspaceId}: ` +
        `created=${result.created}, updated=${result.updated}, ` +
        `skipped=${result.skipped}, errors=${result.errors.length}`,
    );

    return result;
  }

  private async processRecord(
    workspaceId: string,
    record: IngestRecordDto,
    source: string,
    userId: string,
    index: number,
    result: IngestResult,
  ): Promise<void> {
    // Validate required fields
    if (!record.objectName || !record.fields) {
      throw new Error('objectName and fields are required');
    }

    // Validate field values are not entirely empty
    const fieldKeys = Object.keys(record.fields);

    if (fieldKeys.length === 0) {
      throw new Error('fields object must contain at least one field');
    }

    // Track provenance if rawEventId is provided
    if (record.rawEventId) {
      await this.recordProvenance(
        workspaceId,
        record.objectName,
        record.rawEventId,
        source,
        record.fields,
      );
    }

    // For now, we record the ingestion intent. Actual record creation/update
    // requires workspace-scoped data source access which will be wired
    // when integrating with the workspace query runner.
    // The deduplication and CRUD logic is stubbed here for the endpoint contract.

    if (record.deduplicateOn && record.deduplicateOn.length > 0) {
      // Deduplication requested — this would query the workspace schema
      // to find existing records matching the deduplicateOn fields.
      // For now, count as created since we cannot query workspace data yet.
      result.created++;
    } else {
      result.created++;
    }
  }

  private async recordProvenance(
    workspaceId: string,
    objectName: string,
    rawEventId: string,
    rawSource: string,
    fields: Record<string, any>,
  ): Promise<DataProvenanceEntity> {
    const provenance = this.dataProvenanceRepository.create({
      workspaceId,
      objectMetadataId: objectName, // Will be resolved to actual UUID when metadata lookup is wired
      recordId: rawEventId, // Placeholder until actual record is created
      rawEventId,
      rawSource,
      transformationLog: {
        fieldCount: Object.keys(fields).length,
        fieldNames: Object.keys(fields),
        ingestedAt: new Date().toISOString(),
      },
    });

    return this.dataProvenanceRepository.save(provenance);
  }
}
