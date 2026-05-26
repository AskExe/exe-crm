import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'fieldAuditLog', schema: 'core' })
@Index(['workspaceId', 'recordId'])
@Index(['workspaceId', 'objectMetadataId'])
export class FieldAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'uuid' })
  objectMetadataId: string;

  @Column({ type: 'uuid' })
  recordId: string;

  @Column({ type: 'varchar' })
  fieldName: string;

  @Column({ type: 'jsonb', nullable: true })
  oldValue: any;

  @Column({ type: 'jsonb', nullable: true })
  newValue: any;

  @Column({ type: 'uuid' })
  changedByUserId: string;

  @Column({ type: 'varchar' })
  changedBySource: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  changedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  rawEventId: string;
}
