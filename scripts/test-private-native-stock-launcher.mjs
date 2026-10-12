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
  snapshotMode = null,
  producerDiagnostic = null,
  lateProducerDiagnostic = false,
  stderrNeverEnds = false,
  cleanupPending = false,
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
  const signals = [];
  const boundary = Error('Controlled child spawn boundary');
  const {
    run,
    launcherFailureStderr,
    reportLauncherFailure,
    refusalReason,
    Refused,
    Frames,
  } = runInNewContext(
    `${source}\n({run, launcherFailureStderr, reportLauncherFailure, refusalReason, Refused, Frames})`,
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
        kill: (_pid, signal) => {
          if (cleanupPending && signal === 'SIGTERM') {
            signals.push(signal);
            const child = children[0];
            child.stderr.once('end', () => child.emit('close', null, signal));
            child.stderr.end();
            return;
          }
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
          if (producerDiagnostic !== null && !lateProducerDiagnostic)
            child.stderr.write(producerDiagnostic);
          if (snapshotMode === 'expiry') return;
          if (snapshotMode === 'partial')
            child.stdio[3].write(Buffer.from([0, 0]));
          if (snapshotMode === 'stream') {
            child.stdio[3].emit('error', Error('private transport secret'));
          } else if (snapshotMode && snapshotMode !== 'partial') {
            const value =
              snapshotMode === 'canonical'
                ? '{ "private":true}'
                : snapshotMode === 'shape'
                  ? '{}'
                  : JSON.stringify({
                      actionId: 'invalid',
                      workspaceId: 'invalid',
                      customApplicationId: 'invalid',
                      standardApplicationId: 'invalid',
                    });
            const body = Buffer.from(value),
              head = Buffer.alloc(4);
            head.writeUInt32BE(body.length);
            child.stdio[3].write(Buffer.concat([head, body]));
          }
          for (const stream of child.stdio) {
            if (
              stream === child.stderr &&
              (lateProducerDiagnostic || stderrNeverEnds || cleanupPending)
            )
              continue;
            stream.end();
          }
          const close = () => child.emit('close', 1, null);
          if (cleanupPending) return;
          if (delayedClosure) releaseClosure = close;
          else if (lateProducerDiagnostic)
            setImmediate(() => {
              child.stderr.end(producerDiagnostic);
              close();
            });
          else close();
        });
        return child;
      },
    },
  );
  return {
    run,
    refusalReason,
    Refused,
    Frames,
    calls,
    boundary,
    environment,
    launcherFailureStderr,
    reportLauncherFailure,
    diagnostics,
    release: () => releaseClosure?.(),
    children,
    signals,
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
    'primaryReason',
    'spawned',
    'childClosed',
    'childStatus',
    'childSignal',
  ]);
  assert.equal(row.phase, 'native-spawn');
  assert.equal(row.primaryReason, null);
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
  assert.equal(record.primaryReason, 'truncated_frame');
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
  assert.equal(JSON.parse(stderr.split('\n')[1]).primaryReason, 'Other');
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
  assert.equal(first.primaryReason, 'truncated_frame');
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

for (const [mode, reason] of [
  ['expiry', 'original_end'],
  ['canonical', 'canonical_frame'],
  ['shape', 'closed_frame'],
  ['application', 'application_snapshot'],
  ['stream', 'native_stream_error'],
]) {
  test(`snapshot ${mode} retains its finite first reason before cleanup`, async () => {
    const fixture = launcher({
      childFailure: true,
      delayedClosure: true,
      remaining: mode === 'expiry' ? 30 : 200000,
      snapshotMode: mode,
    });
    const pending = fixture.run().catch((error) => error);
    // Wait only for the existing early report; child cleanup is still held.
    const until = performance.now() + 1000;
    while (!fixture.diagnostics.length && performance.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fixture.diagnostics.length, 1);
    const record = JSON.parse(fixture.diagnostics[0].split('\n')[1]);
    assert.equal(record.kind, 'crm-stock-launcher-failure-v2');
    assert.equal(record.phase, 'native-snapshot');
    assert.equal(record.primaryReason, reason);
    assert.equal(record.childClosed, false);
    assert.equal(record.childStatus, null);
    if (mode === 'expiry') fixture.children[0].emit('close', 1, null);
    else fixture.release();
    const error = await pending;
    assert.equal(fixture.diagnostics.length, 1);
    assert.equal(
      JSON.parse(fixture.launcherFailureStderr(error).split('\n')[1])
        .primaryReason,
      reason,
    );
    assert.ok(!fixture.diagnostics[0].includes('private transport secret'));
  });
}

test('reason projection never evaluates getters or arbitrary codes and requires the exact local prototype', () => {
  const fixture = launcher();
  let reads = 0;
  for (const code of [
    'original_end',
    'truncated_frame',
    'canonical_frame',
    'closed_frame',
    'application_snapshot',
    'native_stream_error',
  ])
    assert.equal(fixture.refusalReason(new fixture.Refused(code)), code);
  const unknown = new fixture.Refused('postgresql://private:secret@host/db');
  assert.equal(fixture.refusalReason(unknown), 'Other');
  const getter = new fixture.Refused('original_end');
  Object.defineProperty(getter, 'code', {
    get() {
      reads++;
      throw Error('secret');
    },
  });
  Object.defineProperty(getter, 'message', {
    get() {
      reads++;
      throw Error('secret');
    },
  });
  Object.defineProperty(getter, 'stack', {
    get() {
      reads++;
      throw Error('secret');
    },
  });
  assert.equal(fixture.refusalReason(getter), 'Other');
  const inherited = new fixture.Refused('original_end');
  delete inherited.code;
  assert.equal(fixture.refusalReason(inherited), 'Other');
  class Subclass extends fixture.Refused {}
  assert.equal(fixture.refusalReason(new Subclass('original_end')), null);
  assert.equal(
    fixture.refusalReason(
      Object.assign(Error('secret'), { code: 'original_end' }),
    ),
    null,
  );
  assert.equal(reads, 0);
});

test('fragmented frames consume buffered prefixes without starving the remaining bytes', async () => {
  const { Frames } = launcher();
  const body = Buffer.from('{"test":"snapshot"}');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  const frame = Buffer.concat([header, body]);
  for (const split of [0, 1, 3, 4, 5, frame.length - 1, frame.length]) {
    const stream = new PassThrough();
    const end = performance.now() + 2000;
    const reader = new Frames(stream, () => end, 2048);
    const pending = reader.frame(1024).then(
      (bytes) => ({ bytes }),
      (error) => ({ error }),
    );
    stream.write(frame.subarray(0, split));
    await new Promise(setImmediate);
    stream.end(frame.subarray(split));
    const result = await pending;
    assert.ifError(result.error);
    assert.ok(result.bytes.equals(body), `split ${split}`);
    assert.equal(await reader.frame(1024, true), null);
    assert.equal(reader.charged, frame.length);
  }
});

test('partial frame EOF stays refused and adjacent frames are not over-read', async () => {
  const { Frames } = launcher();
  const body = Buffer.from('{"test":"snapshot"}');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  const frame = Buffer.concat([header, body]);
  for (const length of [0, 1, 3, 4, 5, frame.length - 1]) {
    const stream = new PassThrough();
    const end = performance.now() + 2000;
    const reader = new Frames(stream, () => end, 2048);
    stream.end(frame.subarray(0, length));
    await assert.rejects(
      reader.frame(1024),
      (error) => error.code === 'truncated_frame',
    );
  }
  const stream = new PassThrough();
  const end = performance.now() + 2000;
  const reader = new Frames(stream, () => end, 2048);
  stream.end(Buffer.concat([frame, frame]));
  assert.ok((await reader.frame(1024)).equals(body));
  assert.equal(reader.charged, frame.length);
  assert.ok((await reader.frame(1024)).equals(body));
  assert.equal(reader.charged, 2 * frame.length);
  assert.equal(await reader.frame(1024, true), null);
});

const producerFailure = (stage) =>
  JSON.stringify({
    kind: 'crm-stock-producer-failure-v1',
    producerStage: stage,
  }) + '\nPrivate stock command requires reconciliation\n';
for (const [snapshotMode, delivery] of [
  [null, 'zero'],
  ['partial', 'partial'],
  ['shape', 'complete'],
]) {
  test(`closed producer stage supplements primary v2 with ${delivery} FD3 delivery`, async () => {
    const fixture = launcher({
      childFailure: true,
      snapshotMode,
      producerDiagnostic: producerFailure('stock-prepare'),
    });
    let error;
    await assert.rejects(fixture.run, (e) => {
      error = e;
      return true;
    });
    assert.equal(fixture.diagnostics.length, 2);
    const first = JSON.parse(fixture.diagnostics[0].split('\n')[1]),
      last = JSON.parse(fixture.diagnostics[1].split('\n')[1]);
    assert.equal(first.kind, 'crm-stock-launcher-failure-v2');
    assert.equal(last.kind, 'crm-stock-launcher-failure-v3');
    assert.equal(last.producerStage, 'stock-prepare');
    assert.equal(last.snapshotDelivery, delivery);
    const shared = { ...last };
    delete shared.kind;
    delete shared.producerStage;
    delete shared.snapshotDelivery;
    const primary = { ...first };
    delete primary.kind;
    assert.deepEqual(shared, primary);
    assert.equal(fixture.launcherFailureStderr(error), fixture.diagnostics[0]);
    assert.equal(
      error.primary.code,
      snapshotMode === 'shape' ? 'closed_frame' : 'truncated_frame',
    );
  });
}
for (const [snapshotMode, delivery] of [
  [null, 'zero'],
  ['partial', 'partial'],
]) {
  test(`early standalone stage survives termination during pending cleanup: ${delivery}`, async () => {
    const fixture = launcher({
      childFailure: true,
      snapshotMode,
      cleanupPending: true,
      producerDiagnostic:
        producerFailure('stock-prepare-activate').split('\n')[0] + '\n',
    });
    let failure;
    await assert.rejects(fixture.run, (error) => {
      failure = error;
      return true;
    });
    assert.deepEqual(fixture.signals, ['SIGTERM']);
    assert.equal(fixture.diagnostics.length, 2);
    const first = JSON.parse(fixture.diagnostics[0].split('\n')[1]);
    const last = JSON.parse(fixture.diagnostics[1].split('\n')[1]);
    assert.equal(first.primaryReason, 'truncated_frame');
    assert.equal(first.childClosed, false);
    assert.equal(last.producerStage, 'stock-prepare-activate');
    assert.equal(last.snapshotDelivery, delivery);
    const { kind, producerStage, snapshotDelivery, ...primary } = last;
    assert.deepEqual(primary, (({ kind, ...rest }) => rest)(first));
    assert.equal(failure.primary.code, 'truncated_frame');
    assert.equal(failure.closure.closed, true);
    assert.equal(failure.closure.signal, 'SIGTERM');
    assert.equal(failure.closure.stderrEof, true);
    assert.ok(fixture.children[0].stdio.every((stream) => stream.destroyed));
  });
}

for (const text of [
  producerFailure('stock-prepare').split('\n')[0] + '\nextra\n',
  (producerFailure('stock-prepare').split('\n')[0] + '\n').repeat(2),
  producerFailure('stock-prepare').replace(
    'producerStage',
    'producer\\u0053tage',
  ),
  producerFailure('stock-prepare').replace('{', '{ '),
  Buffer.from([0xff]),
  Buffer.alloc(513),
  producerFailure('secret'),
  producerFailure('stock-storage-unknown'),
  producerFailure('stock-storage-/app/private'),
  producerFailure('stock-storage-postgresql://sentinel-secret@private'),
  producerFailure('stock-storage-11111111-1111-4111-8111-111111111111'),
  producerFailure('stock-prepare') + 'extra',
  JSON.stringify({
    kind: 'crm-stock-producer-failure-v1',
    producerStage: 'stock-prepare',
    secret: 'postgresql://secret',
  }) + '\nPrivate stock command requires reconciliation\n',
]) {
  test('invalid private producer bytes preserve exact v2 fallback', async () => {
    const fixture = launcher({ childFailure: true, producerDiagnostic: text });
    await assert.rejects(fixture.run);
    assert.equal(fixture.diagnostics.length, 1);
    assert.equal(
      JSON.parse(fixture.diagnostics[0].split('\n')[1]).kind,
      'crm-stock-launcher-failure-v2',
    );
    assert.ok(!fixture.diagnostics.join('').includes('postgresql'));
  });
}

test(
  'actual launcher pair reaches strict Core decoded producer measurement',
  { skip: !process.env.CRM_DIAGNOSTIC_CORE_TEST_MODULE },
  async () => {
    const {
      recordStockLauncherFailure,
      privateFailureStderr,
      parsePrivateFailureStderr,
    } = await import(process.env.CRM_DIAGNOSTIC_CORE_TEST_MODULE);
    for (const [snapshotMode, snapshotDelivery] of [
      [null, 'zero'],
      ['partial', 'partial'],
      ['shape', 'complete'],
    ]) {
      const fixture = launcher({
        childFailure: true,
        snapshotMode,
        producerDiagnostic: process.env.CRM_DIAGNOSTIC_PRODUCER_TEST_RECORD
          ? process.env.CRM_DIAGNOSTIC_PRODUCER_TEST_RECORD +
            'Private stock command requires reconciliation\n'
          : producerFailure('issued-frame'),
      });
      await assert.rejects(fixture.run);
      const failure = new Error('postgresql://secret:password@private');
      recordStockLauncherFailure(
        failure,
        Buffer.from(fixture.diagnostics.join('')),
      );
      const row = parsePrivateFailureStderr(privateFailureStderr(failure)).error
        .prelude.launcher;
      assert.equal(row.kind, 'crm-stock-launcher-failure-v3');
      assert.equal(row.producerStage, 'issued-frame');
      assert.equal(row.snapshotDelivery, snapshotDelivery);
      assert.equal(
        row.primaryReason,
        snapshotMode === 'shape' ? 'closed_frame' : 'truncated_frame',
      );
      assert.ok(!privateFailureStderr(failure).includes('postgresql'));
    }
  },
);

test('late private stderr supplements only after existing cleanup and matches early v2', async () => {
  const fixture = launcher({
    childFailure: true,
    producerDiagnostic: producerFailure('stock-prepare'),
    lateProducerDiagnostic: true,
  });
  await assert.rejects(fixture.run);
  assert.equal(fixture.diagnostics.length, 2);
  const first = JSON.parse(fixture.diagnostics[0].split('\n')[1]),
    last = JSON.parse(fixture.diagnostics[1].split('\n')[1]);
  assert.equal(first.childClosed, false);
  assert.equal(last.childClosed, false);
  assert.equal(last.producerStage, 'stock-prepare');
  assert.equal(last.snapshotDelivery, 'zero');
});
test('undrained private stderr preserves only early v2 without additional waits', async () => {
  const fixture = launcher({
    childFailure: true,
    producerDiagnostic: producerFailure('stock-prepare'),
    stderrNeverEnds: true,
  });
  await assert.rejects(fixture.run);
  assert.equal(fixture.diagnostics.length, 1);
  assert.equal(
    JSON.parse(fixture.diagnostics[0].split('\n')[1]).kind,
    'crm-stock-launcher-failure-v2',
  );
});

for (const stage of [
  'stock-prepare-current',
  'stock-prepare-control',
  'stock-prepare-begin',
  'stock-prepare-business',
  'stock-prepare-identity',
  'stock-prepare-custody',
  'stock-prepare-storage',
  'stock-storage-issued',
  'stock-storage-runtime',
  'stock-storage-ancestor-root',
  'stock-storage-ancestor-app',
  'stock-storage-ancestor-local',
  'stock-storage-current-issued',
  'stock-storage-current-deadline',
  'stock-storage-current-old-role',
  'stock-storage-current-core-authority',
  'stock-storage-current-owner-lease',
  'stock-storage-endpoint',
  'stock-storage-metadata',
  'stock-storage-directory-workspace',
  'stock-storage-directory-custom',
  'stock-storage-directory-dependencies',
  'stock-storage-directory-current',
  'stock-storage-entries',
  'stock-storage-file-package',
  'stock-storage-file-lock',
  'stock-storage-file-close',
  'stock-prepare-channel',
  'stock-prepare-context',
  'stock-prepare-activate',
  'stock-prepare-complete',
  'stock-prepare-final-current',
  'stock-prepare-output-bind',
  'stock-prepare-observe',
  'stock-prepare-output-observe',
]) {
  test(`fixed prepare operation ${stage} survives owned launcher projection`, async () => {
    const fixture = launcher({
      childFailure: true,
      producerDiagnostic: producerFailure(stage),
    });
    await assert.rejects(fixture.run);
    const row = JSON.parse(fixture.diagnostics.at(-1).split('\n')[1]);
    assert.equal(row.kind, 'crm-stock-launcher-failure-v3');
    assert.equal(row.producerStage, stage);
    assert.equal(row.snapshotDelivery, 'zero');
    assert.equal(row.primaryReason, 'truncated_frame');
    if (process.env.CRM_DIAGNOSTIC_CORE_TEST_MODULE) {
      const {
        recordStockLauncherFailure,
        privateFailureStderr,
        parsePrivateFailureStderr,
      } = await import(process.env.CRM_DIAGNOSTIC_CORE_TEST_MODULE);
      const failure = new Error('postgresql://sentinel-secret@private');
      recordStockLauncherFailure(
        failure,
        Buffer.from(fixture.diagnostics.join('')),
      );
      assert.equal(
        parsePrivateFailureStderr(privateFailureStderr(failure)).error.prelude
          .launcher.producerStage,
        stage,
      );
      assert.ok(!privateFailureStderr(failure).includes('sentinel-secret'));
    }
  });
}
