import { type ObjectLiteral, type QueryRunner } from 'typeorm';

import { capturePrivateInsertEvent } from './private-insert-event-snapshot';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import {
  type DatabaseBatchEventInput,
  type WorkspaceEventEmitter,
} from 'src/engine/workspace-event-emitter/workspace-event-emitter';

type Event = DatabaseBatchEventInput<ObjectLiteral, DatabaseEventAction>;

// Internal transaction state, never a request field or a public permission mode.
export class PrivateInsertEvents {
  private events: Event[] = [];
  private acknowledged = false;
  private published = false;
  private abandoned = false;

  constructor(
    readonly queryRunner: QueryRunner,
    readonly workspaceId: string,
    private readonly originalEnd?: { remaining(): number },
  ) {}

  assertActive() {
    this.originalEnd?.remaining();
    if (
      this.abandoned ||
      this.acknowledged ||
      this.published ||
      this.queryRunner.isReleased ||
      !this.queryRunner.isTransactionActive
    )
      throw new Error('Private insert transaction unavailable');
  }

  retain(event: Event | undefined) {
    this.assertActive();
    if (!event) return;
    if (
      event.workspaceId !== this.workspaceId ||
      event.objectMetadataNameSingular !== 'person' ||
      this.events.length >= 2 ||
      event.events.length < 1 ||
      event.events.length > 1000 ||
      ![DatabaseEventAction.CREATED, DatabaseEventAction.UPSERTED].includes(
        event.action,
      )
    )
      throw new Error('Private insert event unavailable');
    this.events.push(capturePrivateInsertEvent(event));
  }

  acknowledgeCommit() {
    if (
      this.abandoned ||
      this.acknowledged ||
      this.queryRunner.isTransactionActive ||
      this.events.length < 1
    )
      throw new Error('Private commit acknowledgement unavailable');
    this.acknowledged = true;
  }

  abandon() {
    this.abandoned = true;
    this.events = [];
  }

  publish(emitter: WorkspaceEventEmitter) {
    if (!this.acknowledged || this.abandoned || this.published)
      throw new Error('Private events unavailable');
    // Set before emit: a thrown subscriber never causes automatic re-publication.
    this.published = true;
    const events = this.events;
    this.events = [];
    for (const event of events) emitter.emitDatabaseBatchEvent(event);
  }
}
