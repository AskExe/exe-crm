import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for bug d859577c.
 *
 * The security-scan job's "Secret scan (gitleaks)" step must run BEFORE any
 * dependency-install step, so gitleaks (`detect --no-git`) walks a clean tree
 * instead of ~2,300 freshly installed third-party packages under
 * node_modules. Running it after install was measured at 15m41s of pure
 * waste and once hit the job's 40-minute cap, cancelling an unrelated PR (run
 * 33320312638, PR #125) — and it dilutes the signal the scan exists to
 * produce, since .gitleaks.toml's allowlist suppresses findings but does not
 * stop the walk and covers none of node_modules.
 *
 * This was fixed once already in e9fbea6a13 (2026-09-01) and was silently
 * REGRESSED by a later workflow restructuring that reordered the job's steps
 * without anyone noticing gitleaks had drifted back after `yarn install`.
 * This test asserts the property directly against the step order in the
 * committed workflow YAML — not against a specific step layout — so any
 * future reordering that puts an install step ahead of gitleaks again turns
 * this red, regardless of what else moves around it.
 *
 * Belt-and-braces: also asserts .gitleaks.toml explicitly excludes
 * node_modules/, so the signal-dilution half of this bug stays fixed even if
 * step order ever drifts again.
 */

const ROOT = process.cwd();

const read = (relPath: string): string =>
  readFileSync(path.join(ROOT, relPath), 'utf8');

type Step = { name: string; index: number };

/**
 * Text-based step extraction, matching the convention already used by
 * tests/supply-chain-pins.test.ts and tests/sso-env-contract.test.ts for this
 * workflow file — no YAML parser dependency required. Steps are matched by
 * their `- name: ...` line, in document order, restricted to the body of the
 * named job (from its `<job>:` header to the next top-level (0-indent) job
 * key, or end of file).
 */
const extractJobSteps = (workflowYaml: string, jobName: string): Step[] => {
  const jobHeaderRe = new RegExp(`^  ${jobName}:\\s*$`, 'm');
  const jobStart = workflowYaml.search(jobHeaderRe);
  if (jobStart === -1) {
    throw new Error(
      `job "${jobName}" not found in workflow — has it been renamed?`,
    );
  }

  const rest = workflowYaml.slice(jobStart + workflowYaml.slice(jobStart).indexOf('\n') + 1);
  const nextJobRe = /^  [A-Za-z0-9_-]+:\s*$/m;
  const nextJobMatch = rest.match(nextJobRe);
  const jobBody = nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;

  const stepNameRe = /^\s*-\s*name:\s*(.+)\s*$/gm;
  const steps: Step[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = stepNameRe.exec(jobBody)) !== null) {
    steps.push({ name: match[1].trim(), index: index++ });
  }
  return steps;
};

const indexOfStepMatching = (steps: Step[], pattern: RegExp): number =>
  steps.findIndex((s) => pattern.test(s.name));

describe('security-scan job: gitleaks runs before dependency install (bug d859577c)', () => {
  const workflowYaml = read('.github/workflows/ci.yml');
  const steps = extractJobSteps(workflowYaml, 'security-scan');

  it('has a Secret scan (gitleaks) step and at least one install step, to make this assertion meaningful', () => {
    expect(indexOfStepMatching(steps, /gitleaks/i)).toBeGreaterThanOrEqual(0);
    expect(
      indexOfStepMatching(steps, /install\s+dependencies/i),
    ).toBeGreaterThanOrEqual(0);
  });

  it('runs the gitleaks secret scan before ANY dependency-install step', () => {
    const gitleaksIndex = indexOfStepMatching(steps, /gitleaks/i);
    const installIndexes = steps
      .filter((s) => /install\s+dependencies/i.test(s.name))
      .map((s) => s.index);

    for (const installIndex of installIndexes) {
      expect(
        gitleaksIndex,
        `"${steps[gitleaksIndex]?.name}" (step ${gitleaksIndex}) must precede ` +
          `"${steps[installIndex]?.name}" (step ${installIndex}) — gitleaks ` +
          `must scan a clean tree, never one with node_modules installed`,
      ).toBeLessThan(installIndex);
    }
  });

  it('excludes node_modules/ from the gitleaks scan as a belt-and-braces guard', () => {
    const gitleaksConfig = read('.gitleaks.toml');
    expect(gitleaksConfig).toMatch(/node_modules/);
  });
});
