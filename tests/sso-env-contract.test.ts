import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

/**
 * SSO env contract (bugs 2e2b5225 / 2355a199).
 *
 * GoTrue signs HS256 and deliberately publishes an empty JWKS, so the CRM's
 * symmetric-key fallback is the ONLY viable verification path — and it
 * silently fails closed when GOTRUE_JWT_SECRET never reaches the container.
 * That defect is invisible from inside the image: the CRM boots healthy and
 * every login just bounces. The release contract (stack.release.json
 * config.requiredEnv) is what a stack operator audits to decide which env
 * vars a deployment must hand over, so it must DECLARE the SSO verification
 * env — a var missing from that list reads as optional and ships broken
 * (bug 2e2b5225: the exe-os stack ran a compose that omitted it).
 *
 * The exe-os stack compose already fail-louds on these with `:?`; this test
 * pins the exe-crm side of the contract: declared required, and actually
 * passed through by the compose file this repo ships.
 */
describe('exe-crm SSO env contract', () => {
  const stackRelease = JSON.parse(read('stack.release.json')) as {
    stackParticipation: { config: { requiredEnv: string[] } };
  };
  const compose = read('packages/twenty-docker/docker-compose.yml');

  // The minimum env the GoTrue SSO bridge needs to verify ANY apex session.
  const SSO_REQUIRED_ENV = ['GOTRUE_URL', 'GOTRUE_JWT_SECRET'];

  it('declares the SSO verification env in stack.release.json requiredEnv', () => {
    const requiredEnv = stackRelease.stackParticipation.config.requiredEnv;
    for (const envVar of SSO_REQUIRED_ENV) {
      expect(requiredEnv, `requiredEnv must declare ${envVar}`).toContain(
        envVar,
      );
    }
  });

  it.each(SSO_REQUIRED_ENV)(
    'docker-compose.yml passes %s through to the server container',
    (envVar) => {
      expect(compose).toContain(`${envVar}: \${${envVar}:-}`);
    },
  );
});
