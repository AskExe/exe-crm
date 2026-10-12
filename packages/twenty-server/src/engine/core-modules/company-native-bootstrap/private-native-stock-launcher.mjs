// Source-only: fixed CRM supplier launcher. Not mounted or qualified yet.
import { writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const CHILD =
  '/app/dist/engine/core-modules/company-native-bootstrap/private-native-stock-bootstrap.entry.js';
const REQUEST = 12 * 1024 ** 2 + 1024,
  RESULT = 24 * 1024 ** 2,
  DIAGNOSTIC = 1024 ** 2;
const TRANSPORT = 2 * (REQUEST + RESULT + 1024) + 16384 + DIAGNOSTIC + 4096;
class Refused extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const need = (ok, code) => {
  if (!ok) throw new Refused(code);
};
function canonical(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  need(Buffer.from(JSON.stringify(value)).equals(bytes), 'canonical_frame');
  return value;
}
function exact(value, keys) {
  need(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join() === keys.slice().sort().join(),
    'closed_frame',
  );
}
function applicationSnapshot(value, actionId) {
  exact(value, [
    'actionId',
    'workspaceId',
    'customApplicationId',
    'standardApplicationId',
  ]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  need(
    value.actionId === actionId &&
      Object.values(value).every(
        (v) => typeof v === 'string' && uuid.test(v),
      ) &&
      value.customApplicationId !== value.standardApplicationId,
    'application_snapshot',
  );
  return Object.freeze({ ...value });
}
function sdkRequest(request, applications, sequence) {
  exact(request, [
    'version',
    'actionId',
    'workspaceId',
    'applicationId',
    'applicationUniversalIdentifier',
    'schema',
  ]);
  need(
    (sequence === 1 || sequence === 2) &&
      request.version === 1 &&
      request.actionId === applications.actionId &&
      request.workspaceId === applications.workspaceId &&
      request.applicationId ===
        (sequence === 1
          ? applications.standardApplicationId
          : applications.customApplicationId) &&
      request.applicationUniversalIdentifier ===
        (sequence === 1
          ? '20202020-64aa-4b6f-b003-9c74b97cee20'
          : applications.customApplicationId) &&
      typeof request.schema === 'string' &&
      Buffer.byteLength(request.schema) > 0 &&
      Buffer.byteLength(request.schema) <= 2 * 1024 ** 2 &&
      !request.schema.includes('\0'),
    'sdk_request',
  );
  return request;
}
// A bounded exact reader owns each stream; no host fd is expected in Docker.
class Frames {
  constructor(stream, deadline, quota) {
    this.stream = stream;
    this.deadline = deadline;
    this.quota = quota;
    this.charged = 0;
  }
  async bytes(size, eof = false) {
    need(size > 0 && size <= RESULT + 1024, 'frame_size');
    const parts = [];
    let total = 0;
    while (total < size) {
      need(performance.now() < this.deadline(), 'original_end');
      // read(n) can re-emit readable for an unconsumed short prefix and starve
      // the I/O delivering the rest. Consume available bytes without over-read.
      const available = this.stream.readableLength;
      const chunk = this.stream.read(
        available > 0 ? Math.min(size - total, available) : size - total,
      );
      if (chunk !== null) {
        need(Buffer.isBuffer(chunk), 'binary_frame');
        parts.push(chunk);
        total += chunk.length;
        this.charged += chunk.length;
        need(this.charged <= this.quota, 'transport_quota');
        continue;
      }
      if (this.stream.readableEnded) {
        if (eof && total === 0) return null;
        throw new Refused('truncated_frame');
      }
      await new Promise((resolve, reject) => {
        const done = (error) => {
          clearTimeout(timer);
          this.stream.off('readable', ready);
          this.stream.off('end', ready);
          this.stream.off('error', failed);
          error ? reject(error) : resolve();
        };
        const ready = () => done(),
          failed = () => done(new Refused('stream_error'));
        const timer = setTimeout(
          () => done(new Refused('original_end')),
          Math.max(1, this.deadline() - performance.now()),
        );
        this.stream.once('readable', ready);
        this.stream.once('end', ready);
        this.stream.once('error', failed);
      });
    }
    return Buffer.concat(parts, total);
  }
  async frame(max, eof = false) {
    const head = await this.bytes(4, eof);
    if (head === null) return null;
    const size = head.readUInt32BE();
    need(size > 0 && size <= max, 'frame_bound');
    return this.bytes(size);
  }
}
async function write(stream, bytes, end) {
  need(performance.now() < end(), 'original_end');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Refused('original_end')),
      Math.max(1, end() - performance.now()),
    );
    let finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    }
    stream.write(bytes, (error) =>
      finish(error ? new Refused('write_error') : null),
    );
  });
  need(performance.now() < end(), 'original_end');
}
async function framed(stream, bytes, end) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  await write(stream, header, end);
  await write(stream, bytes, end);
}
const failures = new WeakMap();
const reported = new WeakSet();
const failureClass = (error) => {
  let prototype;
  try {
    prototype =
      error && typeof error === 'object' ? Object.getPrototypeOf(error) : null;
  } catch {
    return 'Other';
  }
  return prototype === Refused.prototype
    ? 'Refused'
    : prototype === Error.prototype
      ? 'Error'
      : prototype === TypeError.prototype
        ? 'TypeError'
        : prototype === SyntaxError.prototype
          ? 'SyntaxError'
          : 'Other';
};
// Only local Refused instances and own data descriptors can expose a reason.
const refusalReasons = new Set([
  'original_end',
  'truncated_frame',
  'canonical_frame',
  'closed_frame',
  'application_snapshot',
  'native_stream_error',
]);
const refusalReason = (error) => {
  let localRefused = false;
  try {
    if (Object.getPrototypeOf(error) !== Refused.prototype) return null;
    localRefused = true;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor &&
      Object.hasOwn(descriptor, 'value') &&
      typeof descriptor.value === 'string' &&
      refusalReasons.has(descriptor.value)
      ? descriptor.value
      : 'Other';
  } catch {
    return localRefused ? 'Other' : null;
  }
};
const producerStages = new Set([
  'input-admission',
  'issued-frame',
  'operator-trust',
  'operator-profile',
  'storage-secrets',
  'database-connect',
  'authority-check',
  'pending-allocation',
  'pending-observation',
  'stock-imports',
  'stock-fence',
  'stock-checkpoint',
  'stock-session',
  'stock-prepare',
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
  'stock-final-check',
]);
function producerStage(bytes) {
  try {
    if (bytes.length > 512) return null;
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) return null;
    const lines = text.split('\n');
    if (
      lines.length !== 3 ||
      lines[1] !== 'Private stock command requires reconciliation' ||
      lines[2] !== ''
    )
      return null;
    const value = JSON.parse(lines[0]);
    exact(value, ['kind', 'producerStage']);
    if (
      Reflect.ownKeys(value).length !== 2 ||
      JSON.stringify(value) !== lines[0]
    )
      return null;
    if (
      !Object.keys(value).every((key) =>
        Object.hasOwn(
          Object.getOwnPropertyDescriptor(value, key) ?? {},
          'value',
        ),
      )
    )
      return null;
    return value.kind === 'crm-stock-producer-failure-v1' &&
      typeof value.producerStage === 'string' &&
      producerStages.has(value.producerStage)
      ? value.producerStage
      : null;
  } catch {
    return null;
  }
}
// Only this module's owned catch writes metadata. Caller lookalikes are ignored.
export function launcherFailureStderr(error) {
  const value =
    error && typeof error === 'object' ? failures.get(error) : undefined;
  return (
    'Private stock launcher requires reconciliation\n' +
    JSON.stringify({
      kind: 'crm-stock-launcher-failure-v2',
      ...(value ?? {
        phase: 'unavailable',
        primaryClass: 'Other',
        primaryReason: null,
        spawned: false,
        childClosed: null,
        childStatus: null,
        childSignal: null,
      }),
    }) +
    '\n'
  );
}
// One small record is written before any owned cleanup wait; no streams or
// arbitrary exception properties enter this channel. Failed writes never change refusal.
export function reportLauncherFailure(error) {
  const owned = error && typeof error === 'object';
  if (owned && reported.has(error)) return true;
  try {
    writeSync(2, launcherFailureStderr(error));
    if (owned) reported.add(error);
    return true;
  } catch {
    return false;
  }
}
export async function run() {
  const diagnostic = {
    phase: 'runtime-admission',
    spawned: false,
    primary: null,
  };
  try {
    return await runOwned(diagnostic);
  } catch (error) {
    if (error && typeof error === 'object')
      failures.set(
        error,
        diagnostic.firstRecord ?? {
          phase: diagnostic.primaryPhase ?? diagnostic.phase,
          primaryClass: failureClass(diagnostic.primary ?? error),
          primaryReason: refusalReason(diagnostic.primary ?? error),
          spawned: diagnostic.spawned,
          childClosed: diagnostic.childClosed ?? null,
          childStatus: diagnostic.childStatus ?? null,
          childSignal: diagnostic.childSignal ?? null,
        },
      );
    if (diagnostic.reported && error && typeof error === 'object')
      reported.add(error);
    throw error;
  }
}
async function runOwned(diagnostic) {
  need(
    process.platform === 'linux' &&
      process.getuid() === 1000 &&
      process.argv.length === 2 &&
      process.env.CRM_PRIVATE_STOCK_LAUNCHER_ENABLED === 'true',
    'runtime_admission',
  );
  const started = performance.now();
  let end = started + 5000;
  const input = new Frames(process.stdin, () => end, TRANSPORT);
  diagnostic.phase = 'initial-frame';
  const raw = await input.frame(16384);
  need(raw.at(-1) === 10, 'issued_line');
  const issued = canonical(raw.subarray(0, -1));
  exact(issued, [
    'version',
    'tuple',
    'initial_sql_time',
    'original_lease_expires_at',
    'remaining_work_milliseconds',
  ]);
  need(
    issued.version === 'core-first-writer-v1' &&
      issued.tuple?.product === 'crm-workspace' &&
      Number.isSafeInteger(issued.remaining_work_milliseconds) &&
      issued.remaining_work_milliseconds > 0 &&
      issued.remaining_work_milliseconds <= 210000,
    'issued_frame',
  );
  // Native's existing closed reader independently validates the whole tuple.
  // This limit only bounds transport; actual Core/native SQL fences shrink it.
  end = Math.min(
    started + 181000,
    started + issued.remaining_work_milliseconds,
  );
  diagnostic.phase = 'native-spawn';
  const child = spawn(process.execPath, [CHILD], {
    cwd: '/app',
    env: { ...process.env, CRM_PRIVATE_NATIVE_STOCK_ENABLED: 'true' },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  diagnostic.spawned = Number.isSafeInteger(child.pid) && child.pid > 0;
  diagnostic.childClosed = diagnostic.spawned ? false : null;
  let status = null,
    signal = null,
    closed = false,
    business = [],
    stderr = [],
    stderrBytes = 0,
    businessBytes = 0,
    requests = 0,
    observation = null,
    primary = null,
    failed = false,
    secondaryOverflow = false,
    stdoutEof = false,
    stderrEof = false,
    requestEof = false,
    snapshotComplete = false;
  const cleanup = [],
    stdioClosed = [false, false, false, false, false];
  const remember = (e) => {
    if (!failed) {
      failed = true;
      primary = e;
      diagnostic.primary = e;
      diagnostic.primaryPhase = diagnostic.phase;
      diagnostic.firstRecord = {
        phase: diagnostic.phase,
        primaryClass: failureClass(e),
        primaryReason: refusalReason(e),
        spawned: diagnostic.spawned,
        childClosed: diagnostic.spawned ? closed : null,
        childStatus:
          Number.isInteger(status) && status >= 0 && status <= 255
            ? status
            : null,
        childSignal:
          signal === null
            ? null
            : ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal)
              ? signal
              : 'Other',
      };
      if (e && typeof e === 'object') failures.set(e, diagnostic.firstRecord);
      diagnostic.reported = reportLauncherFailure(e);
    } else if (cleanup.length < 16) cleanup.push(e);
    else secondaryOverflow = true;
  };
  const validPid = () => Number.isSafeInteger(child.pid) && child.pid > 0;
  const streamFailure = () => {
    remember(new Refused('native_stream_error'));
    child.stdio?.[3]?.destroy(new Refused('native_stream_error'));
  };
  let close = Promise.resolve(),
    requestsIn = null;
  try {
    close = new Promise((resolve) =>
      child.once('close', (code, sig) => {
        status = code;
        signal = sig;
        closed = true;
        if (diagnostic.spawned) {
          diagnostic.childClosed = true;
          diagnostic.childStatus =
            Number.isInteger(code) && code >= 0 && code <= 255 ? code : null;
          diagnostic.childSignal =
            sig === null
              ? null
              : ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(sig)
                ? sig
                : 'Other';
        }
        resolve();
      }),
    );
    child.on('error', () => remember(new Refused('native_spawn_error')));
    for (const [index, stream] of (child.stdio ?? []).entries()) {
      stream?.on('error', streamFailure);
      stream?.once('close', () => {
        stdioClosed[index] = true;
      });
    }
    process.stdin.on('error', streamFailure);
    process.stdout.on('error', streamFailure);
    requestsIn = child.stdio?.[3]
      ? new Frames(child.stdio[3], () => end, 2 * REQUEST + 8 + 1028)
      : null;
    need(
      validPid() &&
        child.stdin &&
        child.stdout &&
        child.stderr &&
        child.stdio[3] &&
        child.stdio[4] &&
        requestsIn,
      'native_spawn_streams',
    );
    let retainedDiagnosticBytes = 0;
    const retainDiagnostic = (chunks, kind, b) => {
      if (kind === 'stdout') businessBytes += b.length;
      else stderrBytes += b.length;
      const keep = Math.min(b.length, DIAGNOSTIC - retainedDiagnosticBytes);
      if (keep) {
        chunks.push(Buffer.from(b.subarray(0, keep)));
        retainedDiagnosticBytes += keep;
      }
      if (keep !== b.length) {
        remember(new Refused('combined_diagnostic_bound'));
        child.stdio[3].destroy(new Refused('combined_diagnostic_bound'));
      }
    };
    child.stdout.once('end', () => {
      stdoutEof = true;
    });
    child.stderr.once('end', () => {
      stderrEof = true;
    });
    child.stdout.on('data', (b) => retainDiagnostic(business, 'stdout', b));
    child.stderr.on('data', (b) => retainDiagnostic(stderr, 'stderr', b));
    diagnostic.phase = 'native-input';
    await write(child.stdin, raw, () => end);
    child.stdin.end();
    // Metadata creates the standard application before this first FD3 frame.
    // Workspace is source-authenticated native observation here; parent checks
    // its original plan only when that plan actually holds this value.
    diagnostic.phase = 'native-snapshot';
    const snapshotBytes = await requestsIn.frame(1024);
    snapshotComplete = true;
    const applications = applicationSnapshot(
      canonical(snapshotBytes),
      issued.tuple.action_id,
    );
    await framed(
      process.stdout,
      Buffer.from(JSON.stringify({ kind: 'sdk-bind', snapshot: applications })),
      () => end,
    );
    diagnostic.phase = 'bind-ack';
    const bound = canonical(await input.frame(2048));
    exact(bound, ['kind', 'snapshot']);
    need(
      bound.kind === 'sdk-bound' &&
        Buffer.from(JSON.stringify(bound.snapshot)).equals(snapshotBytes),
      'application_bind_ack',
    );
    await framed(child.stdio[4], snapshotBytes, () => end);
    for (let sequence = 1; sequence <= 2; sequence++) {
      diagnostic.phase = 'sdk-request';
      const requestBytes = await requestsIn.frame(REQUEST),
        request = canonical(requestBytes);
      sdkRequest(request, applications, sequence);
      // The parent additionally checks the issued stock application snapshot,
      // fixed standard/custom order and current original Core action fence.
      await framed(
        process.stdout,
        Buffer.from(JSON.stringify({ kind: 'sdk-request', sequence, request })),
        () => end,
      );
      diagnostic.phase = 'sdk-result';
      const response = canonical(await input.frame(RESULT + 1024));
      exact(response, ['kind', 'sequence', 'result']);
      need(
        response.kind === 'sdk-result' && response.sequence === sequence,
        'sdk_sequence',
      );
      const resultBytes = Buffer.from(JSON.stringify(response.result));
      need(resultBytes.length <= RESULT, 'sdk_result_bound');
      await framed(child.stdio[4], resultBytes, () => end);
      requests = sequence;
    }
    need((await requestsIn.frame(REQUEST, true)) === null, 'extra_sdk_request');
    requestEof = true;
    diagnostic.phase = 'native-close';
    let timer;
    try {
      await Promise.race([
        close,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Refused('original_end')),
            Math.max(1, end - performance.now()),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    need(
      status === 0 &&
        signal === null &&
        !failed &&
        requests === 2 &&
        stdoutEof &&
        stderrEof &&
        requestEof &&
        stdioClosed.every(Boolean),
      'native_refusal',
    );
    const bytes = Buffer.concat(business),
      text = bytes.toString('utf8');
    need(
      text.endsWith('\n') && Buffer.from(text).equals(bytes),
      'native_result',
    );
    diagnostic.phase = 'native-output';
    observation = canonical(bytes.subarray(0, -1));
  } catch (error) {
    remember(error);
  } finally {
    if (!closed && !validPid()) {
      let timer;
      try {
        await Promise.race([
          close,
          new Promise((r) => {
            timer = setTimeout(r, 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!closed && validPid()) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (e) {
        if (e.code !== 'ESRCH') remember(new Refused('term_failed'));
      }
      await Promise.race([close, new Promise((r) => setTimeout(r, 1000))]);
      if (!closed) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (e) {
          if (e.code !== 'ESRCH') remember(new Refused('kill_failed'));
        }
        await Promise.race([close, new Promise((r) => setTimeout(r, 1000))]);
      }
    }
    if (validPid())
      try {
        process.kill(-child.pid, 0);
        remember(new Refused('group_present'));
      } catch (e) {
        if (e.code !== 'ESRCH') remember(new Refused('group_absence_unproved'));
      }
    for (const stream of child.stdio ?? []) stream?.destroy();
    if (!closed) remember(new Refused('reap_unproved'));
  }
  if (failed) {
    // Preserve the already emitted primary/lifecycle snapshot. Only the existing
    // completed cleanup path can supplement it after private stderr reaches EOF.
    const stage =
      closed && stderrEof ? producerStage(Buffer.concat(stderr)) : null;
    if (diagnostic.reported && stage) {
      try {
        writeSync(
          2,
          'Private stock launcher requires reconciliation\n' +
            JSON.stringify({
              kind: 'crm-stock-launcher-failure-v3',
              ...diagnostic.firstRecord,
              producerStage: stage,
              snapshotDelivery: snapshotComplete
                ? 'complete'
                : requestsIn
                  ? requestsIn.charged === 0
                    ? 'zero'
                    : 'partial'
                  : 'unavailable',
            }) +
            '\n',
        );
      } catch {
        // Supplement failure never replaces the original refusal.
      }
    }
    const failure = new Refused('stock_launcher_reconciliation');
    failure.primary = primary;
    failure.cleanup = cleanup;
    failure.secondaryOverflow = secondaryOverflow;
    failure.stderrPrivate = Buffer.concat(stderr);
    failure.stdoutPrivate = Buffer.concat(business);
    failure.closure = {
      closed,
      status,
      signal,
      requests,
      businessBytes,
      stderrBytes,
      stdoutEof,
      stderrEof,
      requestEof,
      stdioClosed: [...stdioClosed],
    };
    process.stdin.off('error', streamFailure);
    process.stdout.off('error', streamFailure);
    throw failure;
  }
  try {
    diagnostic.phase = 'final-frame';
    await framed(
      process.stdout,
      Buffer.from(
        JSON.stringify({
          kind: 'final',
          observation,
          closure: {
            closed,
            status,
            signal,
            requests,
            businessBytes,
            stderrBytes,
            stdoutEof,
            stderrEof,
            requestEof,
            stdioClosed: [...stdioClosed],
          },
        }),
      ),
      () => end,
    );
  } finally {
    process.stdin.off('error', streamFailure);
    process.stdout.off('error', streamFailure);
  }
  return {
    closed,
    status,
    signal,
    requests,
    businessBytes,
    stderrBytes,
    stdoutEof,
    stderrEof,
    requestEof,
    stdioClosed: [...stdioClosed],
  };
}
// Supplier packaging will mount a fixed entry calling run(); this proposal is
// deliberately importable for source review and does not execute on import.
