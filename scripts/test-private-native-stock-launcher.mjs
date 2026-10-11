import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
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
  .replace("import { spawn } from 'node:child_process';", '')
  .replace("import { performance } from 'node:perf_hooks';", '')
  .replace('export async function run()', 'async function run()');
const fixedChild =
  '/app/dist/engine/core-modules/company-native-bootstrap/private-native-stock-bootstrap.entry.js';

function launcher({ admitted = true, remaining = 200000 } = {}) {
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
  const calls = [];
  const boundary = Error('Controlled child spawn boundary');
  const run = runInNewContext(`${source}\nrun`, {
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
    process: {
      platform: 'linux',
      getuid: () => 1000,
      argv: ['/usr/bin/node', '/fixed/launcher'],
      execPath: '/usr/bin/node',
      stdin,
      env: environment,
    },
    spawn: (...args) => {
      calls.push(args);
      throw boundary;
    },
  });
  return { run, calls, boundary, environment };
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
