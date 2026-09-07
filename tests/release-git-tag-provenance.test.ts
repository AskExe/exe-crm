import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for bug c7702beb (ported from exe-erp bug 2c9bf186).
 *
 * ghcr.io/askexe/exe-crm:v0.9.55 was published with no matching git tag:
 * `release-stack-image.yml` accepts `workflow_dispatch` in addition to a tag
 * push, and the published image tag is derived from stack.release.json's
 * `version` field, never from the git ref. Nothing checked whether the
 * version being released had ever been tagged in git, so a workflow_dispatch
 * run against a branch could publish a release-named image for a commit
 * nobody tagged — bytes in the registry that cannot be traced back to a
 * reviewed, tagged commit.
 *
 * exe-erp hit the identical defect (bug 2c9bf186: v0.3.2/3/4 existed with no
 * git tags) and fixed it with a step that asserts the git tag for the
 * declared version exists AND points at the exact commit being built. This
 * test asserts that same shape landed here — against the committed workflow
 * YAML directly, not against a specific step layout, so a future
 * restructuring that drops or reorders the assert turns this red regardless
 * of what else moves around it (this exact class of regression happened to
 * the gitleaks-order fix in bug d859577c).
 */

const ROOT = process.cwd();

const read = (relPath: string): string =>
  readFileSync(path.join(ROOT, relPath), 'utf8');

type Step = { name: string; index: number; body: string };

/**
 * Text-based step extraction, matching the convention already used by
 * tests/ci-security-scan-gitleaks-order.test.ts for this repo's workflow
 * files — no YAML parser dependency required. Steps are matched by their
 * `- name: ...` line, in document order, restricted to the body of the named
 * job (from its `<job>:` header to the next top-level (0-indent) job key, or
 * end of file).
 */
const extractJobSteps = (workflowYaml: string, jobName: string): Step[] => {
  const jobHeaderRe = new RegExp(`^  ${jobName}:\\s*$`, 'm');
  const jobStart = workflowYaml.search(jobHeaderRe);
  if (jobStart === -1) {
    throw new Error(
      `job "${jobName}" not found in workflow — has it been renamed?`,
    );
  }

  const rest = workflowYaml.slice(
    jobStart + workflowYaml.slice(jobStart).indexOf('\n') + 1,
  );
  const nextJobRe = /^  [A-Za-z0-9_-]+:\s*$/m;
  const nextJobMatch = rest.match(nextJobRe);
  const jobBody = nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;

  const stepHeaderRe = /^\s*-\s*name:\s*(.+)\s*$/gm;
  const steps: Step[] = [];
  const matches: { name: string; start: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = stepHeaderRe.exec(jobBody)) !== null) {
    matches.push({ name: match[1].trim(), start: match.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : jobBody.length;
    steps.push({ name: matches[i].name, index: i, body: jobBody.slice(start, end) });
  }
  return steps;
};

const indexOfStepMatching = (steps: Step[], pattern: RegExp): number =>
  steps.findIndex((s) => pattern.test(s.name));

describe('release-image job: git tag provenance gate (bug c7702beb)', () => {
  const workflowYaml = read('.github/workflows/release-stack-image.yml');
  const steps = extractJobSteps(workflowYaml, 'release-image');

  it('is triggered by a tag push (not tag-triggered releases have no git-tag guarantee to assert)', () => {
    const triggerBlock = workflowYaml.slice(0, workflowYaml.indexOf('jobs:'));
    expect(triggerBlock).toMatch(/push:\s*\n\s*tags:/);
  });

  it('has a git-tag-existence assert step in the release-image job', () => {
    const idx = indexOfStepMatching(
      steps,
      /assert this version exists as a git tag/i,
    );
    expect(
      idx,
      'release-image job must contain a step asserting the declared ' +
        'stack.release.json version exists as a git tag (bug c7702beb / erp 2c9bf186)',
    ).toBeGreaterThanOrEqual(0);
  });

  it('the assert step queries the GitHub git refs API for the tag, not local refs', () => {
    const idx = indexOfStepMatching(
      steps,
      /assert this version exists as a git tag/i,
    );
    const body = steps[idx].body;
    expect(body).toMatch(/git\/ref\/tags\//);
  });

  it('the assert step compares the resolved tag commit against github.sha and fails closed on mismatch', () => {
    const idx = indexOfStepMatching(
      steps,
      /assert this version exists as a git tag/i,
    );
    const body = steps[idx].body;
    expect(body).toMatch(/GITHUB_SHA/);
    expect(body).toMatch(/exit 1/);
  });

  it('the assert step runs before the image is built and pushed', () => {
    const assertIdx = indexOfStepMatching(
      steps,
      /assert this version exists as a git tag/i,
    );
    const buildIdx = indexOfStepMatching(steps, /^Build image$/i);
    expect(assertIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThanOrEqual(0);
    expect(
      assertIdx,
      'the git-tag provenance gate must run before the build, or an ' +
        'untagged commit could already be pushed by the time it fails',
    ).toBeLessThan(buildIdx);
  });

  it('has no break-glass override for the git-tag provenance gate (deliberate — this is "was it released at all")', () => {
    const idx = indexOfStepMatching(
      steps,
      /assert this version exists as a git tag/i,
    );
    const body = steps[idx].body;
    expect(body).not.toMatch(/EXE_ALLOW_[A-Z_]*OVERWRITE|EXE_ALLOW_[A-Z_]*SKIP/);
  });
});
