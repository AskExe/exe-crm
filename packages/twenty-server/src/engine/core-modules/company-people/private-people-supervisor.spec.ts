import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';

import { PrivatePeopleSupervisedAdapter } from './private-people-supervisor';
import { type PrivatePeopleSource } from './private-people-contract';
import { type PeopleCommand } from './private-people-protocol';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('node:fs', () => ({ lstatSync: jest.fn(), realpathSync: jest.fn() }));

const uuid = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
class ControlledChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: string | null = null;
  commands: PeopleCommand[] = [];
  suppress?: string;
  held?: PeopleCommand;
  afterAck?: (command: PeopleCommand) => void;
  kill = jest.fn((signal: string) => {
    this.signalCode = signal;
    queueMicrotask(() => {
      this.stdout.emit('end');
      this.stderr.emit('end');
      this.emit('exit', null, signal);
      this.emit('close', null, signal);
    });
    return true;
  });
  ack(command: PeopleCommand) {
    this.emit('message', {
      version: 1,
      sequence: command.sequence,
      phase: command.phase,
      request_id: command.request_id,
      payload_sha256: command.payload_sha256,
      outcome: 'ok',
      ids: command.phase === 'commit' ? [uuid(20)] : null,
    });
  }
  send(command: PeopleCommand, callback: (error: Error | null) => void) {
    this.commands.push(command);
    callback(null);
    if (this.suppress === command.phase) {
      this.held = command;
      return;
    }
    queueMicrotask(() => {
      this.ack(command);
      this.afterAck?.(command);
      if (command.phase === 'publish') {
        this.exitCode = 0;
        this.stdout.emit('end');
        this.stderr.emit('end');
        this.emit('exit', 0, null);
        this.emit('close', 0, null);
      }
    });
  }
}
const deadline = (milliseconds: number) => {
  const controller = new AbortController();
  const end = performance.now() + milliseconds;
  return {
    signal: controller.signal,
    remaining: () => {
      const n = Math.floor(end - performance.now());
      if (controller.signal.aborted || n < 1)
        throw new Error('controlled original end');
      return n;
    },
    abort: () => controller.abort(),
  };
};
const fixture = () => {
  const payload = Buffer.from('[{"name":"Contact","email":"a@example.test"}]');
  const source: PrivatePeopleSource = {
    version: 2,
    purpose: 'business-action',
    product: 'crm',
    resource_kind: 'crm-workspace',
    request_id: uuid(1),
    subject_id: uuid(2),
    company_id: uuid(3),
    binding_id: uuid(4),
    native_id: uuid(5),
    generation_id: uuid(6),
    client_id: 'client-a',
    audience: 'crm-a',
    authz_epoch: '1',
    policy_revision: '1',
    current_role: 'member',
    action: 'crm:people:create',
    commerce: null,
    payload_sha256: createHash('sha256').update(payload).digest('hex'),
    expires_at: '2099-01-01T00:00:00Z',
  };
  const child = new ControlledChild();
  jest
    .mocked(spawn)
    .mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  jest.mocked(lstatSync).mockReturnValue({
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    nlink: 1,
    mode: 0o100755,
  } as ReturnType<typeof lstatSync>);
  jest.mocked(realpathSync).mockImplementation((path) => String(path));
  const end = deadline(500);
  const adapter = new PrivatePeopleSupervisedAdapter(true);
  return {
    child,
    source,
    payload,
    end,
    adapter,
    handle: adapter.createHandle(source, payload, end),
  };
};

describe('private one-shot supervisor (controlled ChildProcess, not Linux/SQL proof)', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const getuid = process.getuid;
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.getuid = () => 1000;
  });
  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    process.getuid = getuid;
    jest.useFakeTimers();
  });
  it('default-off and synchronous handle creation never spawn', () => {
    const f = fixture();
    expect(spawn).not.toHaveBeenCalled();
    expect(() =>
      new PrivatePeopleSupervisedAdapter().createHandle(
        f.source,
        f.payload,
        f.end,
      ),
    ).toThrow();
  });
  it('uses only the fixed executable, entry and closed environment', async () => {
    const f = fixture();
    await f.handle.prepare();
    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/node',
      [
        '--max-old-space-size=512',
        '/app/packages/twenty-server/dist/engine/core-modules/company-people/private-people-worker.entry.js',
      ],
      expect.objectContaining({
        detached: false,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
      }),
    );
    await f.handle.rollback(deadline(400));
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
  });
  it('retains custody of hung acquisition and kills without retry or publish', async () => {
    const f = fixture();
    f.child.suppress = 'prepare';
    const pending = f.handle.prepare();
    f.end.abort();
    await expect(pending).rejects.toThrow();
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(spawn).toHaveBeenCalledTimes(1);
    await expect(f.handle.prepare()).rejects.toThrow();
    await expect(f.handle.postCommit(deadline(400))).rejects.toThrow();
  });
  it('hung commit and a late ACK stay uncertain and never publish', async () => {
    const f = fixture();
    await f.handle.prepare();
    f.child.suppress = 'commit';
    const pending = f.handle.commit();
    f.end.abort();
    await expect(pending).rejects.toThrow();
    if (f.child.held) f.child.ack(f.child.held);
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
    await expect(f.handle.postCommit(deadline(400))).rejects.toThrow();
    expect(f.child.commands.filter((c) => c.phase === 'commit')).toHaveLength(
      1,
    );
    expect(f.child.commands.filter((c) => c.phase === 'publish')).toHaveLength(
      0,
    );
  });
  it('hung dedicated pool closure is fail-stop rather than disposal success', async () => {
    const f = fixture();
    await f.handle.prepare();
    await f.handle.commit();
    f.child.suppress = 'dispose';
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    await expect(f.handle.postCommit(deadline(400))).rejects.toThrow();
  });
  it('earlier cleanup cannot be enlarged by later longer disposal', async () => {
    const f = fixture();
    await f.handle.prepare();
    await f.handle.rollback(deadline(325));
    await new Promise<void>((resolve) => setTimeout(resolve, 330));
    await expect(f.handle.dispose(deadline(500))).rejects.toThrow();
    expect(f.child.commands.some((c) => c.phase === 'dispose')).toBe(false);
    // Exact known worker remains owned; explicit work abort, not a renewed cleanup.
    f.end.abort();
  });
  it('capture overflow retains the child and refuses ACK/publish', async () => {
    const f = fixture();
    f.child.suppress = 'prepare';
    const pending = f.handle.prepare();
    f.child.stdout.emit('data', Buffer.alloc(65537));
    await expect(pending).rejects.toThrow();
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
    expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('native ACK and disposal do not publish before final Core acceptance', async () => {
    const f = fixture();
    await f.handle.prepare();
    await f.handle.commit();
    await f.handle.dispose(deadline(400));
    expect(f.child.commands.some((c) => c.phase === 'publish')).toBe(false);
    await f.handle.postCommit(f.end);
    expect(f.child.commands.filter((c) => c.phase === 'publish')).toHaveLength(
      1,
    );
    await expect(f.handle.postCommit(f.end)).rejects.toThrow();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('valid ACK then capture fatal before continuation cannot become prepare success', async () => {
    const f = fixture();
    f.child.afterAck = () => f.child.stdout.emit('data', Buffer.alloc(65537));
    await expect(f.handle.prepare()).rejects.toThrow();
    await expect(f.handle.commit()).rejects.toThrow();
    await expect(f.handle.dispose(deadline(400))).rejects.toThrow();
    expect(f.child.commands.filter((c) => c.phase === 'commit')).toHaveLength(
      0,
    );
  });
  it('otherwise clean final exit cannot hide a protocol fatal after publish ACK', async () => {
    const f = fixture();
    await f.handle.prepare();
    await f.handle.commit();
    await f.handle.dispose(deadline(400));
    f.child.afterAck = (command) => {
      if (command.phase === 'publish') f.child.emit('message', {});
    };
    await expect(f.handle.postCommit(f.end)).rejects.toThrow();
    expect(f.child.exitCode).toBe(0);
    await expect(f.handle.postCommit(f.end)).rejects.toThrow();
  });
  it('unique valid commit IDs must also match the exact captured payload row count', async () => {
    const f = fixture();
    const payload = Buffer.from(
      '[{"name":"A","email":"a@example.test"},{"name":"B","email":"b@example.test"}]',
    );
    const source = {
      ...f.source,
      action: 'crm:people:import' as const,
      payload_sha256: createHash('sha256').update(payload).digest('hex'),
    };
    const handle = f.adapter.createHandle(source, payload, f.end);
    await handle.prepare();
    // Controlled child returns one canonical ID for a two-row immutable payload.
    await expect(handle.commit()).rejects.toThrow();
    await expect(handle.dispose(deadline(400))).rejects.toThrow();
    expect(f.child.commands.filter((c) => c.phase === 'publish')).toHaveLength(
      0,
    );
  });
});
