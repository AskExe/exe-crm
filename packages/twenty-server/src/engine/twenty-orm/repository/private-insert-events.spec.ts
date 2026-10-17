import { ObjectRecordCreateEvent } from 'twenty-shared/database-events';

import { type ObjectLiteral, type QueryRunner } from 'typeorm';

import { WorkspaceInsertQueryBuilder } from './workspace-insert-query-builder';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import {
  type DatabaseBatchEventInput,
  type WorkspaceEventEmitter,
} from 'src/engine/workspace-event-emitter/workspace-event-emitter';

import { PrivateInsertEvents } from './private-insert-events';

const fixture = () => {
  const runner = {
    isReleased: false,
    isTransactionActive: true,
  };
  const emitDatabaseBatchEvent = jest.fn();
  const emitter = {
    emitDatabaseBatchEvent,
  } as unknown as WorkspaceEventEmitter;
  const queue = new PrivateInsertEvents(runner as QueryRunner, 'workspace-a');
  const event = {
    workspaceId: 'workspace-a',
    action: DatabaseEventAction.CREATED,
    objectMetadataNameSingular: 'person',
    objectMetadata: {},
    events: [{ record: { id: 'record-a' } }],
  } as unknown as DatabaseBatchEventInput<
    Record<string, unknown>,
    DatabaseEventAction
  >;
  return { runner, emitter, queue, event, emitDatabaseBatchEvent };
};

describe('private owned INSERT events (controlled transaction state)', () => {
  it('binds an empty active queue, retains CREATED and UPSERTED, and publishes only after acknowledgement', () => {
    const f = fixture();
    // Controlled builder carrier invokes the actual private binding boundary.
    const setQueryRunner = jest.fn();
    const builder = {
      shouldBypassPermissionChecks: false,
      internalContext: { workspaceId: 'workspace-a' },
      setQueryRunner,
    } as unknown as WorkspaceInsertQueryBuilder<ObjectLiteral>;
    expect(
      WorkspaceInsertQueryBuilder.prototype.usePrivateTransaction.call(
        builder,
        f.queue,
      ),
    ).toBe(builder);
    expect(setQueryRunner).toHaveBeenCalledWith(f.runner);
    f.queue.retain(f.event);
    f.queue.retain({ ...f.event, action: DatabaseEventAction.UPSERTED });
    expect(() => f.queue.publish(f.emitter)).toThrow();
    expect(f.emitDatabaseBatchEvent).not.toHaveBeenCalled();
    f.runner.isTransactionActive = false;
    f.queue.acknowledgeCommit();
    f.runner.isReleased = true;
    f.queue.publish(f.emitter);
    expect(
      f.emitDatabaseBatchEvent.mock.calls.map(([event]) => event.action),
    ).toEqual([DatabaseEventAction.CREATED, DatabaseEventAction.UPSERTED]);
  });
  it('refuses acknowledgement while the owned runner remains active', () => {
    const f = fixture();
    expect(() => f.queue.acknowledgeCommit()).toThrow();
  });
  it('publishes exactly once after acknowledgement and runner release', () => {
    const f = fixture();
    f.queue.retain(f.event);
    f.runner.isTransactionActive = false;
    f.queue.acknowledgeCommit();
    f.runner.isReleased = true;
    f.queue.publish(f.emitter);
    expect(f.emitDatabaseBatchEvent).toHaveBeenCalledTimes(1);
    expect(() => f.queue.publish(f.emitter)).toThrow();
  });
  it('rollback abandonment discards all retained events', () => {
    const f = fixture();
    f.queue.retain(f.event);
    f.queue.abandon();
    f.runner.isTransactionActive = false;
    expect(() => f.queue.acknowledgeCommit()).toThrow();
    expect(() => f.queue.publish(f.emitter)).toThrow();
    expect(f.emitDatabaseBatchEvent).not.toHaveBeenCalled();
  });
  it('a subscriber failure never permits automatic republishing', () => {
    const f = fixture();
    f.queue.retain(f.event);
    f.runner.isTransactionActive = false;
    f.queue.acknowledgeCommit();
    f.emitDatabaseBatchEvent.mockImplementation(() => {
      throw new Error('subscriber');
    });
    expect(() => f.queue.publish(f.emitter)).toThrow('subscriber');
    expect(() => f.queue.publish(f.emitter)).toThrow();
    expect(f.emitDatabaseBatchEvent).toHaveBeenCalledTimes(1);
  });
  it('refuses a foreign workspace and a released runner', () => {
    const f = fixture();
    expect(() =>
      f.queue.retain({ ...f.event, workspaceId: 'workspace-b' }),
    ).toThrow();
    f.runner.isReleased = true;
    expect(() => f.queue.retain(f.event)).toThrow();
  });
  it('snapshot mutation cannot change the deferred event', () => {
    const f = fixture();
    f.queue.retain(f.event);
    f.event.objectMetadataNameSingular = 'changed';
    f.runner.isTransactionActive = false;
    f.queue.acknowledgeCommit();
    f.queue.publish(f.emitter);
    expect(
      f.emitDatabaseBatchEvent.mock.calls[0][0].objectMetadataNameSingular,
    ).toBe('person');
  });
  it('preserves real native event classes and Date values without retaining aliases', () => {
    const f = fixture();
    const native = new ObjectRecordCreateEvent<Record<string, unknown>>();
    const date = new Date(0);
    native.recordId = 'record-a';
    native.properties = { after: { createdAt: date } };
    f.queue.retain({ ...f.event, events: [native] });
    date.setTime(1000);
    f.runner.isTransactionActive = false;
    f.queue.acknowledgeCommit();
    f.queue.publish(f.emitter);
    const emitted = f.emitDatabaseBatchEvent.mock.calls[0][0].events[0];
    expect(emitted).toBeInstanceOf(ObjectRecordCreateEvent);
    expect(emitted.properties.after.createdAt.getTime()).toBe(0);
  });
  it('refuses a third event and an oversized event before commit', () => {
    const f = fixture();
    f.queue.retain(f.event);
    f.queue.retain(f.event);
    expect(() => f.queue.retain(f.event)).toThrow();
    const g = fixture();
    expect(() =>
      g.queue.retain({ ...g.event, events: Array(1001).fill({}) }),
    ).toThrow();
  });
});
