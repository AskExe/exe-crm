import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FieldAuditLogEntity } from 'src/engine/core-modules/field-audit/field-audit.entity';

@Injectable()
export class FieldAuditService {
  private readonly logger = new Logger(FieldAuditService.name);

  constructor(
    @InjectRepository(FieldAuditLogEntity)
    private readonly fieldAuditLogRepository: Repository<FieldAuditLogEntity>,
  ) {}

  async trackChanges(
    workspaceId: string,
    objectMetadataId: string,
    recordId: string,
    oldRecord: Record<string, any>,
    newRecord: Record<string, any>,
    changedByUserId: string,
    changedBySource: string,
    rawEventId?: string,
  ): Promise<FieldAuditLogEntity[]> {
    const changedFields = this.diffRecords(oldRecord, newRecord);

    if (changedFields.length === 0) {
      return [];
    }

    const auditEntries = changedFields.map((fieldName) =>
      this.fieldAuditLogRepository.create({
        workspaceId,
        objectMetadataId,
        recordId,
        fieldName,
        oldValue: this.wrapValue(oldRecord[fieldName]),
        newValue: this.wrapValue(newRecord[fieldName]),
        changedByUserId,
        changedBySource,
        rawEventId: rawEventId ?? undefined,
      }),
    );

    const saved = await this.fieldAuditLogRepository.save(auditEntries);

    this.logger.log(
      `Tracked ${saved.length} field changes for record ${recordId} in workspace ${workspaceId}`,
    );

    return saved;
  }

  private diffRecords(
    oldRecord: Record<string, any>,
    newRecord: Record<string, any>,
  ): string[] {
    const allKeys = new Set([
      ...Object.keys(oldRecord),
      ...Object.keys(newRecord),
    ]);

    const changedKeys: string[] = [];

    for (const key of allKeys) {
      const oldVal = oldRecord[key];
      const newVal = newRecord[key];

      if (!this.isEqual(oldVal, newVal)) {
        changedKeys.push(key);
      }
    }

    return changedKeys;
  }

  private isEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }

    if (a === null || a === undefined || b === null || b === undefined) {
      return a === b;
    }

    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Wrap primitives so jsonb column always receives a valid JSON value
  private wrapValue(value: unknown): any {
    if (value === undefined) {
      return null;
    }

    return value;
  }
}
