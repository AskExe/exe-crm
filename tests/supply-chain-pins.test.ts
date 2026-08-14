import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Supply-chain guard for customer-facing artifacts — bug 112eb501.
 *
 * exe-crm is a hard fork of Twenty with a deliberate ZERO upstream
 * relationship. Carrying inherited SOURCE is fine: it is frozen at the commit
 * we took. EXECUTING an upstream-controlled artifact at a mutable reference is
 * not: `@main`, `:latest` and `:16` are live channels a third party can
 * repoint at any moment, and two of these sites run inside our CUSTOMERS'
 * pipelines, on their runners, with their secrets.
 *
 * These assertions cover the artifacts we generate and ship. They are written
 * as absence checks on purpose — a reviewer can tell at a glance what is
 * forbidden, and any reintroduction of the old shape turns this file red.
 */

const ROOT = process.cwd();

const read = (relPath: string): string =>
  readFileSync(path.join(ROOT, relPath), 'utf8');

/**
 * Comments never execute, and the files below deliberately NAME the forbidden
 * patterns in prose so the next reader understands why the pin exists. Strip
 * comments before asserting, so documenting the hazard does not itself trip the
 * gate — otherwise the only way to keep this file green is to delete the
 * explanation, which is exactly backwards.
 */
const stripTsComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const stripYamlComments = (source: string): string =>
  source.replace(/^\s*#.*$/gm, '');

const UPSTREAM_ORG = /twentyhq\//;
const UPSTREAM_REGISTRY_NAMESPACE = /twentycrm\//;
const MUTABLE_BRANCH_REF = /@main\b/;
const FLOATING_LATEST_TAG = /:latest\b/;
const SECRETS_REFERENCE = /secrets\./;

describe('customer-facing CI artifacts are free of upstream execution paths', () => {
  // The template SOURCE. The workflow it emits is asserted separately, against
  // real generated output, in
  // packages/create-twenty-app/src/utils/__tests__/test-template.spec.ts —
  // a string template can only be proven by running it.
  const scaffoldTemplate = stripTsComments(
    read('packages/create-twenty-app/src/utils/test-template.ts'),
  );

  // A SHIPPED example app. Customers copy this file, so the pattern in it
  // propagates by hand as well as by scaffolding.
  const helloWorldWorkflowRaw = read(
    'packages/twenty-apps/hello-world/.github/workflows/ci.yml',
  );
  const helloWorldWorkflow = stripYamlComments(helloWorldWorkflowRaw);

  const artifacts = [
    ['create-twenty-app workflow template', scaffoldTemplate],
    ['hello-world example CI workflow', helloWorldWorkflow],
  ] as const;

  describe.each(artifacts)('%s', (_name, content) => {
    it('should not execute anything from the upstream Twenty organisation', () => {
      expect(content).not.toMatch(UPSTREAM_ORG);
    });

    it('should not reference the upstream container registry namespace', () => {
      expect(content).not.toMatch(UPSTREAM_REGISTRY_NAMESPACE);
    });

    it('should not reference a mutable branch ref', () => {
      expect(content).not.toMatch(MUTABLE_BRANCH_REF);
    });

    it('should not reference a floating latest tag', () => {
      expect(content).not.toMatch(FLOATING_LATEST_TAG);
    });

    it('should not hand a secret to any step', () => {
      expect(content).not.toMatch(SECRETS_REFERENCE);
    });
  });

  it('should pin every action in the shipped example workflow to a commit SHA', () => {
    const uses = helloWorldWorkflowRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('uses:'));

    expect(uses.length).toBeGreaterThan(0);

    for (const use of uses) {
      expect(use).toMatch(/^uses: [^@\s]+@[0-9a-f]{40}\b/);
    }
  });

  it('should restrict the shipped example workflow token to read-only', () => {
    expect(helloWorldWorkflow).toMatch(/^permissions:$/m);
    expect(helloWorldWorkflow).toMatch(/^ {2}contents: read$/m);
  });
});

describe('SDK local dev server image is pinned by digest', () => {
  const dockerContainerRaw = read(
    'packages/twenty-sdk/src/cli/utilities/server/docker-container.ts',
  );
  const dockerContainer = stripTsComments(dockerContainerRaw);

  it('should not pull a floating tag', () => {
    expect(dockerContainer).not.toMatch(FLOATING_LATEST_TAG);
  });

  it('should not pull a mutable branch ref', () => {
    expect(dockerContainer).not.toMatch(MUTABLE_BRANCH_REF);
  });

  it('should name the image by an immutable sha256 digest', () => {
    expect(dockerContainer).toMatch(
      /IMAGE_DIGEST\s*=\s*\n?\s*'sha256:[0-9a-f]{64}'/,
    );
    expect(dockerContainer).toContain('`${IMAGE_REPOSITORY}@${IMAGE_DIGEST}`');
  });
});
