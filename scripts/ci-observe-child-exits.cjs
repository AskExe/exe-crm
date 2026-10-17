// Observe CI worker termination without changing process or Jest behavior.
const { channel } = require('node:diagnostics_channel');
const {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  writeSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const record = (value) => {
  let fd;
  try {
    fd = openSync(
      join(process.env.RUNNER_TEMP, 'server-unit-test-process-exits.jsonl'),
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.()
    )
      return;
    const line = `${JSON.stringify(value)}\n`;
    if (stat.size + Buffer.byteLength(line) > 1024 * 1024 - 64) {
      const marker = '{"observations":"truncated"}\n';
      if (stat.size + Buffer.byteLength(marker) <= 1024 * 1024)
        writeSync(fd, marker);
      return;
    }
    writeSync(fd, line);
  } catch {
    // Observation must not replace the process's original exit or signal.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Closing diagnostic custody must not replace the original exit.
      }
    }
  }
};

if (require.main !== module) {
  channel('child_process').subscribe(({ process: child }) => {
    child.once('exit', (code, signal) => {
      record({ parent: process.pid, child: child.pid, code, signal });
    });
  });

  process.once('exit', (code) => {
    record({ process: process.pid, code });
  });
}

if (require.main === module && process.argv[2] === '--initialize') {
  const fd = openSync(
    join(process.env.RUNNER_TEMP, 'server-unit-test-process-exits.jsonl'),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  closeSync(fd);
}

const reportProcessSummary = () => {
  let fd;
  let summary;
  try {
    fd = openSync(
      join(process.env.RUNNER_TEMP, 'server-unit-test-process-exits.jsonl'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const observedStat = fstatSync(fd);
    if (
      !observedStat.isFile() ||
      observedStat.nlink !== 1 ||
      observedStat.size > 1024 * 1024
    )
      throw new Error('OBSERVATION_BOUND');
    const observed = readFileSync(fd);
    closeSync(fd);
    fd = undefined;
    if (observed.length > 1024 * 1024) throw new Error('OBSERVATION_BOUND');
    const parsed = observed
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const truncated = parsed.some(
      (row) =>
        Object.keys(row).join(',') === 'observations' &&
        row.observations === 'truncated',
    );
    const rows = parsed.filter(
      (row) =>
        !(
          Object.keys(row).join(',') === 'observations' &&
          row.observations === 'truncated'
        ),
    );
    for (const row of rows) {
      const keys = Object.keys(row).sort().join(',');
      const processRow =
        keys === 'code,process' &&
        Number.isSafeInteger(row.process) &&
        row.process > 0;
      const childRow =
        keys === 'child,code,parent,signal' &&
        Number.isSafeInteger(row.parent) &&
        row.parent > 0 &&
        Number.isSafeInteger(row.child) &&
        row.child > 0 &&
        (row.signal === null ||
          (typeof row.signal === 'string' &&
            /^SIG[A-Z0-9]{1,24}$/.test(row.signal)));
      if (
        (!processRow && !childRow) ||
        !(
          row.code === null ||
          (Number.isInteger(row.code) && row.code >= 0 && row.code <= 255)
        )
      )
        throw new Error('OBSERVATION_SCHEMA');
    }
    const projected = [];
    for (const row of rows) {
      projected.push(row);
      if (Buffer.byteLength(JSON.stringify(projected)) > 32 * 1024) {
        projected.pop();
        break;
      }
    }
    summary = {
      truncated,
      completeness: 'bounded-observations-only',
      rows: projected,
      totalRows: rows.length,
      omittedRows: rows.length - projected.length,
      bytes: observed.length,
      sha256: createHash('sha256').update(observed).digest('hex'),
    };
  } catch {
    summary = { observations: 'unavailable-or-truncated' };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        summary = { observations: 'unavailable-or-truncated' };
      }
    }
  }
  writeSync(1, `CI_PROCESS_SUMMARY ${JSON.stringify(summary)}\n`);
};

if (require.main === module && process.argv[2] !== '--initialize') {
  let fd;
  try {
    reportProcessSummary();
    fd = openSync(
      join(process.env.RUNNER_TEMP, 'server-unit-test-results.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
      throw new Error('RESULT_BOUND');
    }
    const raw = readFileSync(fd);
    if (raw.length > 64 * 1024 * 1024) throw new Error('RESULT_BOUND');
    const result = JSON.parse(raw.toString('utf8'));
    const counts = {};
    for (const key of [
      'numTotalTests',
      'numPassedTests',
      'numFailedTests',
      'numPendingTests',
      'numTotalTestSuites',
      'numPassedTestSuites',
      'numFailedTestSuites',
    ]) {
      if (!Number.isSafeInteger(result[key]) || result[key] < 0)
        throw new Error('RESULT_SCHEMA');
      counts[key] = result[key];
    }
    if (
      typeof result.success !== 'boolean' ||
      !Array.isArray(result.testResults)
    )
      throw new Error('RESULT_SCHEMA');
    const summary = {
      success: result.success,
      counts,
      jsonBytes: raw.length,
      jsonSha256: createHash('sha256').update(raw).digest('hex'),
      failed: [],
      failedRows: 0,
      omittedFailedRows: 0,
    };
    const text = (value, bytes) =>
      Buffer.from(String(value)).subarray(0, bytes).toString('utf8');
    for (const suite of result.testResults) {
      const assertions = (suite.assertionResults || []).filter(
        (entry) => entry.status === 'failed',
      );
      const failures = assertions.length
        ? assertions.map((entry) => ({
            name: entry.fullName,
            message: (entry.failureMessages || []).join('\n'),
          }))
        : suite.status === 'failed'
          ? [{ name: suite.name, message: suite.message }]
          : [];
      for (const failure of failures) {
        summary.failedRows += 1;
        const row = {
          name: text(failure.name, 512),
          message: text(failure.message, 2048),
          nameTruncated: Buffer.byteLength(String(failure.name)) > 512,
          messageTruncated: Buffer.byteLength(String(failure.message)) > 2048,
        };
        summary.failed.push(row);
        if (Buffer.byteLength(JSON.stringify(summary)) > 60 * 1024) {
          summary.failed.pop();
          summary.omittedFailedRows += 1;
        }
      }
    }
    writeSync(1, `CI_JEST_SUMMARY ${JSON.stringify(summary)}\n`);
    process.exitCode = result.success ? 0 : 1;
  } catch {
    writeSync(1, 'CI_JEST_SUMMARY {"summary":"unavailable"}\n');
    process.exitCode = 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
