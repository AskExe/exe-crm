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
  try {
    writeSync(2, `CI_PROCESS ${JSON.stringify(value)}\n`);
  } catch {
    // Observation must not replace the process's original exit or signal.
  }
};

channel('child_process').subscribe(({ process: child }) => {
  child.once('exit', (code, signal) => {
    record({ parent: process.pid, child: child.pid, code, signal });
  });
});

process.once('exit', (code) => {
  record({ process: process.pid, code });
});

if (require.main === module) {
  let fd;
  try {
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
