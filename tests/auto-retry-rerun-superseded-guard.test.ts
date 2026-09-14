import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Guard for bug 2606eacd (exe-crm half).
 *
 * `auto-retry-classified.yml` called `gh run rerun` bare. The rerun target can
 * be flipped to `cancelled` by the superseded-cancel policy AFTER the
 * workflow_run event fires but BEFORE this job reaches the rerun, and the gh
 * CLI refuses to rerun a cancelled run. Under `set -euo pipefail` that refusal
 * exits non-zero, so an advisory classifier — a workflow whose entire job is to
 * reduce noise — becomes a red check of its own. exe-monitor's PR #44
 * (fa163cf4) hardened exactly this; the same two properties are ported here:
 * re-read the live conclusion before rerunning, and mask the rerun's exit code
 * but never its reason.
 *
 * The rerun tail is EXTRACTED FROM THE COMMITTED YAML and executed under bash
 * against a stubbed `gh`, so this asserts behaviour, not the presence of a
 * string. Text assertions elsewhere in this file strip comment lines first, so
 * prose can never satisfy a claim about what the workflow declares.
 */

const ROOT = process.cwd();
const WORKFLOW_PATH = '.github/workflows/auto-retry-classified.yml';

const workflowRaw = readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
const workflow = workflowRaw
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

const RETRY_MARKER = 'echo "decision=retry reason=infra-classified';

const extractRerunTail = (): string => {
  const idx = workflowRaw.indexOf(RETRY_MARKER);
  if (idx < 0) {
    throw new Error(`rerun tail not found in ${WORKFLOW_PATH}`);
  }
  const lineStart = workflowRaw.lastIndexOf('\n', idx) + 1;
  // The `run:` block body is indented 10 spaces inside the YAML.
  return workflowRaw
    .slice(lineStart)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
};

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  rerunCalls: string;
};

let binDir: string;
let scriptPath: string;

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-2606eacd-'));
  binDir = path.join(dir, 'bin');
  mkdirSync(binDir);
  scriptPath = path.join(dir, 'tail.sh');

  writeFileSync(
    scriptPath,
    ['#!/usr/bin/env bash', 'set -euo pipefail', '', extractRerunTail()].join('\n'),
  );
  chmodSync(scriptPath, 0o755);

  // Stubbed gh: `gh api .../actions/runs/<id>` reports $FAKE_CONCLUSION, and
  // `gh run rerun` logs that it was called and refuses (exit 1) for a
  // cancelled run, as the real CLI does.
  writeFileSync(
    path.join(binDir, 'gh'),
    `#!/usr/bin/env bash
if [ "$1" = "api" ]; then
  echo "\${FAKE_CONCLUSION}"
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "rerun" ]; then
  echo "gh run rerun $*" >> "\${RERUN_LOG}"
  if [ "\${FAKE_CONCLUSION}" = "cancelled" ] || [ "\${FAKE_RERUN_FAILS:-0}" = "1" ]; then
    echo "failed to rerun run: run 999 cannot be rerun; its workflow file may be broken" >&2
    exit 1
  fi
  echo "rerun accepted"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 64
`,
  );
  chmodSync(path.join(binDir, 'gh'), 0o755);
});

const runTail = (env: Record<string, string>): RunResult => {
  const rerunLog = path.join(mkdtempSync(path.join(tmpdir(), 'crm-2606eacd-log-')), 'rerun.log');
  writeFileSync(rerunLog, '');

  const res = spawnSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      RERUN_LOG: rerunLog,
      REPOSITORY: 'AskExe/exe-crm',
      RUN_ID: '999',
      RUN_ATTEMPT: '1',
      annotation_matches: '1',
      ...env,
    },
  });

  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    rerunCalls: readFileSync(rerunLog, 'utf8'),
  };
};

describe('auto-retry rerun guard (bug 2606eacd)', () => {
  it('REFUSES a superseded (cancelled) run — no rerun is ever attempted', () => {
    const result = runTail({ FAKE_CONCLUSION: 'cancelled' });

    expect(result.stdout).toContain('decision=skip reason=superseded');
    expect(result.rerunCalls).toBe('');
  });

  it('PERMITS a legitimate (failure) run — the rerun is attempted', () => {
    const result = runTail({ FAKE_CONCLUSION: 'failure' });

    expect(result.stdout).not.toContain('reason=superseded');
    expect(result.rerunCalls).toContain('gh run rerun');
    expect(result.stdout).toContain('rerun triggered for run 999');
  });

  // CONTROL: green in BOTH states. A guard that simply refused everything
  // would still satisfy the superseded case; it cannot satisfy this one,
  // because refusing everything means the legitimate run never reruns.
  it('control: exits 0 in both states, and reruns in exactly one of them', () => {
    const superseded = runTail({ FAKE_CONCLUSION: 'cancelled' });
    const legitimate = runTail({ FAKE_CONCLUSION: 'failure' });

    expect(superseded.code).toBe(0);
    expect(legitimate.code).toBe(0);
    expect([superseded.rerunCalls !== '', legitimate.rerunCalls !== '']).toEqual([false, true]);
  });

  it('masks the rerun exit code but never its reason', () => {
    const result = runTail({ FAKE_CONCLUSION: 'failure', FAKE_RERUN_FAILS: '1' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('::warning::gh run rerun failed for run 999');
    expect(result.stderr).toContain('cannot be rerun');
  });

  // Not part of this fix — exe-crm already carries a job timeout. Pinned so
  // the property this bug is about elsewhere in the fleet cannot regress out
  // of this repo unnoticed.
  it('keeps a finite timeout-minutes on the job', () => {
    const match = workflow.match(/^\s{4}timeout-minutes:\s*(\d+)\s*$/m);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(5);
    expect(Number(match![1])).toBeLessThanOrEqual(30);
  });
});
