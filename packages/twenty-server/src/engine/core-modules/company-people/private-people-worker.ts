import { capturePrivatePeople } from './private-people-contract';
import {
  createWorkerAdapter,
  assertPrivatePeopleWorkerResources,
  loadPrivatePeopleWorkerPackage,
  type PrivatePeopleWorkerResources,
} from './private-people-worker-package';
import {
  validatePeopleCommand,
  peopleMonotonicNow,
  type PeopleCommand,
  type PeopleReply,
} from './private-people-protocol';
import { type PrivatePeopleAdapter } from './private-people-adapter';
import { WorkerDeadline } from './private-people-worker-deadline';

import { type PrivatePeopleAssemblyLifecycle } from './private-people-assembly-lifecycle';

type Handle = ReturnType<PrivatePeopleAdapter['createHandle']>;
export { WorkerDeadline } from './private-people-worker-deadline';

// A single fixed worker process, no listener/module/provider registration.
export const runPrivatePeopleWorker = () => {
  if (!process.send || !process.connected)
    throw new Error('Private people protected channel unavailable');
  let sequence = 0;
  let active = false;
  let uncertain = false;
  let state: 'new' | 'prepared' | 'committed' | 'disposed' | 'published' =
    'new';
  let resources: PrivatePeopleWorkerResources | undefined;
  let handle: Handle | undefined;
  let lifecycle: PrivatePeopleAssemblyLifecycle | undefined;
  let work: WorkerDeadline | undefined;
  let cleanup: WorkerDeadline | undefined;
  let request = '';
  let digest = '';
  const uncertainExit = () => {
    uncertain = true;
    lifecycle?.abort(new Error('Private people uncertain channel'));
    process.exitCode = 1;
    process.disconnect();
    work?.close();
    cleanup?.close();
  };
  const assertSuccess = () => {
    if (uncertain || !process.connected)
      throw new Error('Private people sticky uncertainty');
  };
  const reply = (
    command: PeopleCommand,
    ids: string[] | null,
    outcome: 'ok' | 'uncertain',
  ) =>
    new Promise<void>((resolve, reject) => {
      const value: PeopleReply = {
        version: 1,
        sequence: command.sequence,
        phase: command.phase,
        request_id: command.request_id,
        payload_sha256: command.payload_sha256,
        outcome,
        ids,
      };
      process.send?.(value, (error: Error | null) =>
        error ? reject(error) : resolve(),
      );
    });
  const receive = async (raw: unknown) => {
    let command: PeopleCommand | undefined;
    try {
      command = validatePeopleCommand(raw);
      if (
        active ||
        uncertain ||
        command.sequence !== sequence + 1 ||
        (state === 'new' && command.phase !== 'prepare') ||
        (state !== 'new' &&
          (command.request_id !== request || command.payload_sha256 !== digest))
      )
        throw new Error('Private people phase unavailable');
      active = true;
      sequence = command.sequence;
      let ids: string[] | null = null;
      if (command.phase === 'prepare') {
        if (state !== 'new' || !command.source || !command.payload)
          throw new Error('Private people preparation unavailable');
        const bytes = Buffer.from(command.payload, 'base64');
        if (bytes.toString('base64') !== command.payload)
          throw new Error('Private people bytes unavailable');
        const captured = capturePrivatePeople(command.source, bytes);
        if (
          captured.source.request_id !== command.request_id ||
          captured.source.payload_sha256 !== command.payload_sha256
        )
          throw new Error('Private people request unavailable');
        request = command.request_id;
        digest = command.payload_sha256;
        work = new WorkerDeadline(
          Math.min(
            command.monotonic_end,
            peopleMonotonicNow() +
              Date.parse(captured.source.expires_at) -
              Date.now(),
          ),
        );
        work.remaining();
        // Fixed package import is inside this same original preparation budget.
        lifecycle = loadPrivatePeopleWorkerPackage(); // Owned handle before prepare awaits.
        work.remaining();
        resources = await lifecycle.prepare(
          work,
          Object.freeze({
            companyId: captured.source.company_id,
            workspaceId: captured.source.native_id,
          }),
        );
        assertSuccess();
        work.remaining();
        assertPrivatePeopleWorkerResources(resources);
        const writer = await resources.orm.getGlobalWorkspaceDataSource();
        assertSuccess();
        work.remaining();
        if (
          writer !== resources.writer ||
          writer.coreDataSource !== resources.core
        )
          throw new Error('Private people dedicated pool binding unavailable');
        handle = createWorkerAdapter(resources).createHandle(
          captured.source,
          bytes,
          work,
        );
        await handle.prepare();
        work.remaining();
        assertSuccess();
        state = 'prepared';
      } else if (command.phase === 'commit') {
        if (state !== 'prepared' || !handle || !work)
          throw new Error('Private people commit unavailable');
        work.shrink(command.monotonic_end);
        const ack = await handle.commit();
        work.remaining();
        if (ack.request_id !== request || ack.commit !== 'acknowledged')
          throw new Error('Private people commit identity unavailable');
        ids = [...ack.native_record_ids];
        assertSuccess();
        state = 'committed';
      } else if (command.phase === 'rollback' || command.phase === 'dispose') {
        if (
          !handle ||
          !resources ||
          !lifecycle ||
          state === 'disposed' ||
          state === 'published'
        )
          throw new Error('Private people disposal unavailable');
        if (!cleanup) cleanup = new WorkerDeadline(command.monotonic_end);
        else cleanup.shrink(command.monotonic_end);
        cleanup.remaining();
        if (command.phase === 'rollback') {
          await handle.rollback(cleanup);
          cleanup.remaining();
        } else {
          await handle.dispose(cleanup);
          cleanup.remaining();
          await lifecycle.disposeIO(cleanup);
          cleanup.remaining();
          assertSuccess();
          state = 'disposed';
        }
      } else {
        if (
          state !== 'disposed' ||
          !handle ||
          !work ||
          !resources ||
          !lifecycle ||
          resources.core.isInitialized ||
          resources.writer.isInitialized
        )
          throw new Error('Private people publication unavailable');
        work.shrink(command.monotonic_end);
        work.remaining();
        await handle.postCommit(work);
        work.remaining();
        assertSuccess();
        await lifecycle.finalize(work);
        work.remaining();
        assertSuccess();
        state = 'published';
      }
      assertSuccess();
      await reply(command, ids, 'ok');
      assertSuccess();
      active = false;
      if (state === 'published') {
        work?.close();
        cleanup?.close();
        process.disconnect();
      }
    } catch (error) {
      lifecycle?.abort(error);
      uncertain = true;
      // Connected refusal may attempt only already-admitted cleanup. Hung,
      // expired or disconnected settlement stays uncertain; parent fail-stop.
      if (process.connected && lifecycle) {
        const refusalSecondary: unknown[] = [];
        if (handle && work) {
          try {
            await handle.rollback(work);
          } catch (cleanupError) {
            refusalSecondary.push(cleanupError);
          }
          try {
            await handle.dispose(work);
          } catch (cleanupError) {
            refusalSecondary.push(cleanupError);
          }
        }
        try {
          await lifecycle.refuse(error, refusalSecondary);
        } catch {
          /* Refusal preserves primary + secondary in owned lifecycle. */
        }
      }
      if (command)
        try {
          await reply(command, null, 'uncertain');
        } catch {
          /* Parent retains exact lost-ACK uncertainty. */
        }
      uncertainExit(); // Never loop/retry/reconstruct authority after a refusal.
    }
  };
  process.on('message', (raw: unknown) => {
    void receive(raw);
  });
  process.on('disconnect', () => {
    if (state !== 'published') {
      uncertain = true;
      lifecycle?.abort(new Error('Private people parent disconnected'));
    }
    work?.close();
    cleanup?.close();
    if (uncertain) process.exitCode = 1;
  });
};
