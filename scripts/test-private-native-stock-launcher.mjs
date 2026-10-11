import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL(
    '../packages/twenty-server/src/engine/core-modules/company-native-bootstrap/private-native-stock-launcher.mjs',
    import.meta.url,
  ),
  'utf8',
)
  .replace("import { writeSync } from 'node:fs';", '')
  .replace("import { spawn } from 'node:child_process';", '')
  .replace("import { performance } from 'node:perf_hooks';", '')
  .replace(/^export /gm, '');
const fixedChild =
  '/app/dist/engine/core-modules/company-native-bootstrap/private-native-stock-bootstrap.entry.js';

function launcher({
  admitted = true,
  remaining = 200000,
  childFailure = false,
  delayedClosure = false,
} = {}) {
  const environment = Object.freeze({
    PATH: '/usr/bin:/bin',
    CRM_PRIVATE_STOCK_LAUNCHER_ENABLED: admitted ? 'true' : 'false',
    CRM_PRIVATE_NATIVE_STOCK_ENABLED: 'false',
  });
  const stdin = new PassThrough();
  const bytes = Buffer.from(
    JSON.stringify({
      version: 'core-first-writer-v1',
      tuple: { product: 'crm-workspace' },
      initial_sql_time: '2026-10-12T00:00:00.000Z',
      original_lease_expires_at: '2026-10-12T00:05:00.000Z',
      remaining_work_milliseconds: remaining,
    }) + '\n',
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  stdin.end(Buffer.concat([header, bytes]));
  const calls = [],
    children = [],
    diagnostics = [];
  let releaseClosure;
  const boundary = Error('Controlled child spawn boundary');
  const { run, launcherFailureStderr, reportLauncherFailure } = runInNewContext(
    `${source}\n({run, launcherFailureStderr, reportLauncherFailure})`,
    {
      Buffer,
      writeSync: (fd, text) => {
        assert.equal(fd, 2);
        diagnostics.push(text);
        return Buffer.byteLength(text);
      },
      performance,
      setTimeout,
      clearTimeout,
      process: {
        platform: 'linux',
        getuid: () => 1000,
        argv: ['/usr/bin/node', '/fixed/launcher'],
        execPath: '/usr/bin/node',
        stdin,
        stdout: new PassThrough(),
        kill: () => {
          throw Object.assign(Error('absent'), { code: 'ESRCH' });
        },
        env: environment,
      },
      spawn: (...args) => {
        calls.push(args);
        if (!childFailure) throw boundary;
        const child = new EventEmitter();
        children.push(child);
        child.pid = 123;
        child.stdio = Array.from({ length: 5 }, () => new PassThrough());
        [child.stdin, child.stdout, child.stderr] = child.stdio;
        setImmediate(() => {
          for (const stream of child.stdio) stream.end();
          const close = () => child.emit('close', 1, null);
          if (delayedClosure) releaseClosure = close;
          else close();
        });
        return child;
      },
    },
  );
  return {
    run,
    calls,
    boundary,
    environment,
    launcherFailureStderr,
    reportLauncherFailure,
    diagnostics,
    release: () => releaseClosure?.(),
    children,
  };
}

test('admitted launcher supplies its fixed child stock flag without changing inherited environment', async () => {
  const fixture = launcher();
  await assert.rejects(fixture.run, (error) => error === fixture.boundary);
  assert.equal(fixture.calls.length, 1);
  const [executable, args, options] = fixture.calls[0];
  assert.equal(executable, '/usr/bin/node');
  assert.equal(args.length, 1);
  assert.equal(args[0], fixedChild);
  assert.equal(options.cwd, '/app');
  assert.equal(options.detached, true);
  assert.equal(options.stdio.join(','), 'pipe,pipe,pipe,pipe,pipe');
  assert.notEqual(options.env, fixture.environment);
  assert.deepEqual(
    Object.keys(options.env).sort(),
    Object.keys(fixture.environment).sort(),
  );
  assert.equal(options.env.CRM_PRIVATE_NATIVE_STOCK_ENABLED, 'true');
  assert.equal(options.env.PATH, fixture.environment.PATH);
  assert.equal(options.env.CRM_PRIVATE_STOCK_LAUNCHER_ENABLED, 'true');
  assert.equal(fixture.environment.CRM_PRIVATE_NATIVE_STOCK_ENABLED, 'false');
  assert.equal(Object.isFrozen(fixture.environment), true);
});

for (const [name, options, code] of [
  ['unadmitted launcher', { admitted: false }, 'runtime_admission'],
  ['invalid issued allowance', { remaining: 210001 }, 'issued_frame'],
]) {
  test(`${name} cannot spawn the native stock child`, async () => {
    const fixture = launcher(options);
    await assert.rejects(fixture.run, (error) => error.code === code);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.environment.CRM_PRIVATE_NATIVE_STOCK_ENABLED, 'false');
  });
}

test('closed owned projection retains first refusal and excludes arbitrary properties', async () => {
  const fixture = launcher();
  const secret = 'postgresql://private:secret@host/db';
  fixture.boundary.message = secret;
  Object.defineProperty(fixture.boundary, 'phase', {
    get() {
      throw Error('getter');
    },
  });
  Object.defineProperty(fixture.boundary, 'closure', {
    get() {
      throw Error('getter');
    },
  });
  await assert.rejects(fixture.run, (error) => error === fixture.boundary);
  const text = fixture.launcherFailureStderr(fixture.boundary);
  const row = JSON.parse(text.split('\n')[1]);
  assert.deepEqual(Object.keys(row), [
    'kind',
    'phase',
    'primaryClass',
    'spawned',
    'childClosed',
    'childStatus',
    'childSignal',
  ]);
  assert.equal(row.phase, 'native-spawn');
  assert.equal(row.spawned, false);
  assert.equal(row.childClosed, null);
  assert.equal(row.childStatus, null);
  assert.equal(row.childSignal, null);
  assert.ok(!text.includes(secret));
  assert.equal(
    JSON.parse(
      fixture
        .launcherFailureStderr({ phase: secret, closure: secret })
        .split('\n')[1],
    ).phase,
    'unavailable',
  );
});

test('native snapshot refusal reports closed child flags after mandatory cleanup', async () => {
  const fixture = launcher({ childFailure: true });
  let original;
  await assert.rejects(fixture.run, (error) => {
    original = error;
    return error.code === 'stock_launcher_reconciliation';
  });
  const text = fixture.launcherFailureStderr(original),
    record = JSON.parse(text.split('\n')[1]);
  assert.equal(record.phase, 'native-snapshot');
  assert.equal(record.primaryClass, 'Refused');
  assert.equal(record.spawned, true);
  assert.equal(record.childClosed, true);
  assert.equal(record.childStatus, 1);
  assert.equal(record.childSignal, null);
  assert.equal(original.closure.closed, true);
  assert.equal(original.closure.status, 1);
  assert.equal(original.closure.requests, 0);
  assert.equal(original.closure.stdioClosed.length, 5);
  assert.ok(original.closure.stdioClosed.every((v) => typeof v === 'boolean'));
  assert.ok(fixture.children[0].stdio.every((stream) => stream.destroyed));
  assert.equal(original.primary.code, 'truncated_frame');
  assert.ok(!text.includes('truncated_frame'));
  assert.ok(!text.includes('/app'));
});

test('actual entry retains fixed refusal and only the owned closed record', async () => {
  const fixture = launcher({ admitted: false });
  let original;
  await assert.rejects(fixture.run, (error) => {
    original = error;
    return true;
  });
  const entry = readFileSync(
    new URL(
      '../packages/twenty-server/src/engine/core-modules/company-native-bootstrap/private-native-stock-launcher.entry.ts',
      import.meta.url,
    ),
    'utf8',
  )
    .replace(/^import[\s\S]*?;\n/, '')
    .replace('error: unknown', 'error');
  let stderr = '';
  const process = {
    umask() {},
    stderr: {
      write(value) {
        stderr += value;
      },
    },
    exitCode: 0,
  };
  runInNewContext(entry, {
    run: () => Promise.reject(original),
    reportLauncherFailure: fixture.reportLauncherFailure,
    process,
  });
  await new Promise(setImmediate);
  assert.equal(process.exitCode, 1);
  stderr = fixture.diagnostics.join('');
  assert.equal(
    stderr.split('\n')[0],
    'Private stock launcher requires reconciliation',
  );
  assert.equal(JSON.parse(stderr.split('\n')[1]).phase, 'runtime-admission');
  assert.equal(stderr.split('\n').length, 3);
});

test('first owned refusal is emitted once before delayed child closure', async () => {
  const fixture = launcher({ childFailure: true, delayedClosure: true });
  let settled = false,
    original;
  const pending = fixture
    .run()
    .catch((error) => {
      original = error;
    })
    .finally(() => {
      settled = true;
    });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(fixture.diagnostics.length, 1);
  const first = JSON.parse(fixture.diagnostics[0].split('\n')[1]);
  assert.equal(first.phase, 'native-snapshot');
  assert.equal(first.primaryClass, 'Refused');
  assert.equal(first.spawned, true);
  assert.equal(first.childClosed, false);
  assert.equal(first.childStatus, null);
  assert.equal(first.childSignal, null);
  fixture.release();
  await pending;
  assert.equal(original.primary.code, 'truncated_frame');
  assert.ok(fixture.children[0].stdio.every((stream) => stream.destroyed));
  fixture.reportLauncherFailure(original);
  assert.equal(fixture.diagnostics.length, 1);
});
