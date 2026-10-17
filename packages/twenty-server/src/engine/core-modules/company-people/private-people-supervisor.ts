import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';

import {
  capturePrivatePeople,
  type PrivatePeopleDeadline,
  type PrivatePeopleSource,
} from './private-people-contract';
import { PrivatePeopleUncertain } from './private-people-adapter';
import {
  closedPeopleMessage,
  PEOPLE_LOG_LIMIT,
  PEOPLE_NODE,
  PEOPLE_WORKER,
  peopleMonotonicNow,
  type PeopleCommand,
  type PeoplePhase,
  type PeopleReply,
} from './private-people-protocol';

const fixedExecutable = (path: string, executable: boolean) => {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    stat.nlink !== 1 ||
    stat.mode & 0o022 ||
    realpathSync(path) !== path ||
    (executable && !(stat.mode & 0o111))
  )
    throw new Error('Private people package unavailable');
};

// Internal only: not registered, no caller executable/config/transport option.
export class PrivatePeopleSupervisedAdapter {
  constructor(private readonly enabled = false) {}
  createHandle(
    source: PrivatePeopleSource,
    payload: Uint8Array,
    end: PrivatePeopleDeadline,
  ) {
    if (!this.enabled) throw new Error('Private people unavailable');
    const captured = capturePrivatePeople(source, payload);
    // Commerce was authorized by Core and is not native permission input.
    // Explicit null preserves the closed field on Node's JSON IPC carrier.
    return new SupervisedPeopleTransaction(
      Object.freeze({ ...captured.source, commerce: null }),
      Buffer.from(payload),
      end,
      captured.rows.length,
    );
  }
}

class SupervisedPeopleTransaction {
  private child?: ChildProcess;
  private sequence = 0;
  private state:
    | 'new'
    | 'prepared'
    | 'committed'
    | 'disposed'
    | 'published'
    | 'uncertain' = 'new';
  private pending?: {
    sequence: number;
    phase: PeoplePhase;
    resolve: (reply: PeopleReply) => void;
    reject: (error: unknown) => void;
  };
  private cleanupEnd = Infinity;
  private first?: unknown;
  private secondary: unknown[] = [];
  private exited = false;
  private stdoutEOF = false;
  private stderrEOF = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private workTimer?: ReturnType<typeof setTimeout>;
  private readonly logs = {
    stdout: { bytes: 0, hash: createHash('sha256') },
    stderr: { bytes: 0, hash: createHash('sha256') },
  };
  private readonly abort = () =>
    this.fatal(new Error('Private people original end'));

  constructor(
    private readonly source: PrivatePeopleSource,
    private readonly payload: Buffer,
    private readonly end: PrivatePeopleDeadline,
    private readonly rowCount: number,
  ) {}

  private healthy() {
    if (this.first !== undefined || this.state === 'uncertain')
      throw new PrivatePeopleUncertain(
        this.first ?? new Error('Private people sticky refusal'),
      );
  }
  private fatal(error: unknown) {
    if (this.first === undefined) this.first = error;
    else if (this.secondary.length < 16) this.secondary.push(error);
    this.state = 'uncertain';
    this.pending?.reject(new PrivatePeopleUncertain(this.first));
    this.pending = undefined;
    // Exact retained ChildProcess only. No guessed PID/group or second spawn.
    if (
      this.child &&
      !this.exited &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
      if (!this.child.kill('SIGKILL') && this.secondary.length < 16)
        this.secondary.push(new Error('Private people owned signal unproved'));
  }
  private capture(name: 'stdout' | 'stderr', bytes: Buffer) {
    const log = this.logs[name];
    log.bytes += bytes.length;
    if (log.bytes > PEOPLE_LOG_LIMIT) {
      this.fatal(new Error('Private people output bound'));
      return;
    }
    log.hash.update(bytes); // Discard native bodies; no env/DSN/query proof dumps.
  }
  private bindChild() {
    if (
      process.platform !== 'linux' ||
      process.getuid?.() !== 1000 ||
      this.child
    )
      throw new Error('Private people host unavailable');
    fixedExecutable(PEOPLE_NODE, true);
    fixedExecutable(PEOPLE_WORKER, false);
    this.end.remaining();
    // Retain the returned handle before handlers, publication or any await.
    const child = spawn(
      PEOPLE_NODE,
      ['--max-old-space-size=512', PEOPLE_WORKER],
      {
        cwd: '/app/packages/twenty-server',
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: false,
        serialization: 'json',
      },
    );
    this.child = child;
    child.stdout?.on('data', (bytes: Buffer) => this.capture('stdout', bytes));
    child.stderr?.on('data', (bytes: Buffer) => this.capture('stderr', bytes));
    child.stdout?.on('end', () => {
      this.stdoutEOF = true;
    });
    child.stderr?.on('end', () => {
      this.stderrEOF = true;
    });
    child.stdout?.on('error', (error) => this.fatal(error));
    child.stderr?.on('error', (error) => this.fatal(error));
    child.on('error', (error) => this.fatal(error));
    child.on('message', (value: unknown) => this.reply(value));
    child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
    });
    child.on('close', () => {
      this.exited = true;
      if (this.pending)
        this.fatal(new Error('Private people child acknowledgement lost'));
    });
    this.end.signal.addEventListener('abort', this.abort, { once: true });
    this.workTimer = setTimeout(this.abort, this.end.remaining());
    if (this.end.signal.aborted) this.abort();
  }
  private reply(value: unknown) {
    const pending = this.pending;
    if (
      !pending ||
      this.state === 'uncertain' ||
      !closedPeopleMessage(value, [
        'version',
        'sequence',
        'phase',
        'request_id',
        'payload_sha256',
        'outcome',
        'ids',
      ]) ||
      value.version !== 1 ||
      value.sequence !== pending.sequence ||
      value.phase !== pending.phase ||
      value.request_id !== this.source.request_id ||
      value.payload_sha256 !== this.source.payload_sha256 ||
      !['ok', 'uncertain'].includes(String(value.outcome))
    ) {
      this.fatal(
        new Error('Private people channel acknowledgement unavailable'),
      );
      return;
    }
    if (value.outcome !== 'ok') {
      this.fatal(new Error('Private people child uncertain'));
      return;
    }
    if (
      (pending.phase !== 'commit' && value.ids !== null) ||
      (pending.phase === 'commit' &&
        (!Array.isArray(value.ids) ||
          value.ids.length < 1 ||
          value.ids.length > 1000 ||
          value.ids.length !== this.rowCount ||
          new Set(value.ids).size !== value.ids.length ||
          value.ids.some(
            (id) =>
              typeof id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                id,
              ),
          )))
    ) {
      this.fatal(new Error('Private people child receipt unavailable'));
      return;
    }
    this.pending = undefined;
    pending.resolve(value as PeopleReply);
  }
  private async command(phase: PeoplePhase, deadline: PrivatePeopleDeadline) {
    if (
      !this.child ||
      this.pending ||
      this.exited ||
      this.state === 'uncertain'
    )
      throw new PrivatePeopleUncertain(
        new Error('Private people child unavailable'),
      );
    this.healthy();
    const before = peopleMonotonicNow();
    const admitted = deadline.remaining();
    const cleanupPhase = phase === 'rollback' || phase === 'dispose';
    // Reserve exact reap time INSIDE this same cleanup end, never after it.
    if (cleanupPhase && admitted <= 300) {
      this.fatal(new Error('Private people cleanup reserve unavailable'));
      throw new PrivatePeopleUncertain(this.first);
    }
    const remaining = cleanupPhase ? admitted - 300 : admitted;
    const sequence = ++this.sequence;
    const value: PeopleCommand = {
      version: 1,
      sequence,
      phase,
      remaining,
      monotonic_end: before + remaining,
      request_id: this.source.request_id,
      payload_sha256: this.source.payload_sha256,
      ...(phase === 'prepare'
        ? { source: this.source, payload: this.payload.toString('base64') }
        : {}),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => this.fatal(new Error('Private people phase end'));
    try {
      const reply = await new Promise<PeopleReply>((resolve, reject) => {
        this.pending = { sequence, phase, resolve, reject };
        timer = setTimeout(onAbort, remaining);
        deadline.signal.addEventListener('abort', onAbort, { once: true });
        this.child?.send(value, (error) => {
          if (error) this.fatal(error);
        });
        if (deadline.signal.aborted) onAbort();
      });
      deadline.remaining();
      this.healthy();
      return reply;
    } finally {
      clearTimeout(timer);
      deadline.signal.removeEventListener('abort', onAbort);
    }
  }
  async prepare() {
    if (this.state !== 'new')
      throw new Error('Private people handle already used');
    this.bindChild();
    await this.command('prepare', this.end);
    this.healthy();
    this.state = 'prepared';
  }
  async commit() {
    if (this.state !== 'prepared')
      throw new Error('Private people commit unavailable');
    const reply = await this.command('commit', this.end);
    this.healthy();
    this.state = 'committed';
    return {
      request_id: this.source.request_id,
      native_record_ids: reply.ids ?? [],
      commit: 'acknowledged' as const,
    };
  }
  private cleanup(deadline: PrivatePeopleDeadline): PrivatePeopleDeadline {
    this.cleanupEnd = Math.min(
      this.cleanupEnd,
      performance.now() + deadline.remaining(),
    );
    return {
      signal: deadline.signal,
      remaining: () => {
        const left = Math.floor(
          Math.min(deadline.remaining(), this.cleanupEnd - performance.now()),
        );
        if (left < 1) throw new Error('Private people original cleanup end');
        return left;
      },
    };
  }
  async rollback(deadline: PrivatePeopleDeadline) {
    const bounded = this.cleanup(deadline);
    if (this.state === 'uncertain') {
      await this.stop(bounded);
      return;
    }
    await this.command('rollback', bounded);
    this.healthy();
    this.state = 'uncertain';
  }
  async dispose(deadline: PrivatePeopleDeadline) {
    const bounded = this.cleanup(deadline);
    if (this.state === 'uncertain') {
      await this.stop(bounded);
      throw new PrivatePeopleUncertain(
        this.first ?? new Error('Private people native settlement unproved'),
      );
    }
    if (this.state === 'disposed' || this.state === 'published')
      throw new Error('Private people disposal already used');
    try {
      await this.command('dispose', bounded);
      this.healthy();
      this.state = 'disposed';
    } catch (error) {
      this.fatal(error);
      try {
        await this.stop(bounded);
      } catch (cleanup) {
        if (this.secondary.length < 16) this.secondary.push(cleanup);
      }
      throw new PrivatePeopleUncertain(this.first);
    }
  }
  private async stop(deadline: PrivatePeopleDeadline) {
    this.fatal(new Error('Private people fail stop'));
    if (!this.child) return;
    while (!this.exited) {
      const left = deadline.remaining();
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(5, left)),
      );
    }
    if (!this.stdoutEOF || !this.stderrEOF)
      throw new PrivatePeopleUncertain(
        new Error('Private people EOF unproved'),
      );
    clearTimeout(this.workTimer);
    this.end.signal.removeEventListener('abort', this.abort);
  }
  async postCommit(deadline: PrivatePeopleDeadline) {
    this.healthy();
    if (this.state !== 'disposed')
      throw new Error('Private people publication unavailable');
    try {
      this.healthy();
      this.end.remaining();
      await this.command('publish', deadline);
      this.healthy();
      while (!this.exited) {
        const left = Math.min(this.end.remaining(), deadline.remaining());
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(5, left)),
        );
        this.healthy();
      }
      this.healthy();
      this.end.remaining();
      deadline.remaining();
      if (
        this.exitCode !== 0 ||
        this.exitSignal !== null ||
        !this.stdoutEOF ||
        !this.stderrEOF
      )
        throw new Error('Private people final closure unproved');
      this.state = 'published';
      clearTimeout(this.workTimer);
      this.end.signal.removeEventListener('abort', this.abort);
    } catch (error) {
      this.fatal(error);
      // No renewed publication/cleanup allowance. Fatal signal is owned; await
      // only while the already-admitted publication AND original work ends permit.
      try {
        await this.stop({
          signal: deadline.signal,
          remaining: () => Math.min(this.end.remaining(), deadline.remaining()),
        });
      } catch (cleanup) {
        if (this.secondary.length < 16) this.secondary.push(cleanup);
      }
      throw new PrivatePeopleUncertain(this.first);
    }
  }
}
