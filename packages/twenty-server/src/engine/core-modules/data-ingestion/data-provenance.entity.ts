import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'dataProvenance', schema: 'core' })
@Index(['workspaceId', 'recordId'])
@Index(['workspaceId', 'rawEventId'])
export class DataProvenanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'uuid' })
  objectMetadataId: string;

  @Column({ type: 'uuid' })
  recordId: string;

  @Column({ type: 'uuid' })
  rawEventId: string;

  @Column({ type: 'varchar' })
  rawSource: string;

  @CreateDateColumn({ type: 'timestamptz' })
  ingestedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  transformationLog: any;
}
