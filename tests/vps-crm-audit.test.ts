import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('exe-crm VPS regression audit', () => {
  const entrypoint = read('packages/twenty-docker/twenty/entrypoint.sh');
  const mainTs = read('packages/twenty-server/src/main.ts');
  const compose = read('packages/twenty-docker/docker-compose.yml');
  const stackRelease = JSON.parse(read('stack.release.json')) as {
    version: string;
    image: string;
    imageEnv: string;
  };
  const helmChart = read('packages/twenty-docker/helm/twenty/Chart.yaml');
  const k8sServerDeployment = read(
    'packages/twenty-docker/k8s/manifests/deployment-server.yaml',
  );
  const k8sWorkerDeployment = read(
    'packages/twenty-docker/k8s/manifests/deployment-worker.yaml',
  );
  const podmanManualSteps = read(
    'packages/twenty-docker/podman/manual-steps-to-deploy-twenty-on-podman',
  );
  const accessTokenService = read(
    'packages/twenty-server/src/engine/core-modules/auth/token/services/access-token.service.ts',
  );

  it('entrypoint hard-gates EXE_LICENSE_KEY and rejects placeholder values', () => {
    expect(entrypoint).toContain('assert_exe_license_key()');
    expect(entrypoint).toContain(
      'license_key="${EXE_LICENSE_KEY:-${ENTERPRISE_KEY:-}}"',
    );
    expect(entrypoint).toContain(
      'EXE_LICENSE_KEY is required. Obtain a valid key from https://askexe.com before booting Exe CRM.',
    );
    expect(entrypoint).toMatch(
      /CHANGEME\*\|changeme\*\|replace_me\*\|REPLACE_ME\*\|your_\*\|YOUR_\*\|example\*\|EXAMPLE\*/,
    );
    expect(entrypoint).toContain('export EXE_LICENSE_KEY="$license_key"');
    expect(entrypoint).toContain(
      'export ENTERPRISE_KEY="${ENTERPRISE_KEY:-$license_key}"',
    );
    expect(entrypoint).toMatch(
      /assert_exe_license_key\s*\nsetup_and_migrate_db\s*\nregister_background_jobs/,
    );
  });

  it('main.ts boot path asserts EXE_LICENSE_KEY before Nest startup', () => {
    expect(mainTs).toContain('const assertExeLicenseKey = () => {');
    expect(mainTs).toContain(
      'const licenseKey = process.env.EXE_LICENSE_KEY ?? process.env.ENTERPRISE_KEY;',
    );
    expect(mainTs).toContain(
      '/^(changeme|replace_me|your_|example)/i.test(value)',
    );
    expect(mainTs).toContain(
      'EXE_LICENSE_KEY must be set to a real enterprise key before Exe CRM can boot.',
    );
    expect(mainTs).toContain('process.env.EXE_LICENSE_KEY = licenseKey;');
    expect(mainTs).toContain(
      'process.env.ENTERPRISE_KEY = process.env.ENTERPRISE_KEY ?? licenseKey;',
    );
    expect(mainTs).toMatch(
      /const bootstrap = async \(\) => \{[\s\S]*assertAppSecret\(\);\s*assertExeLicenseKey\(\);/,
    );
  });

  it('docker compose stays parseable after required-var quoting fix', () => {
    const composePath = path.join(
      ROOT,
      'packages/twenty-docker/docker-compose.yml',
    );

    try {
      execFileSync('docker', ['compose', '-f', composePath, 'config'], {
        cwd: ROOT,
        stdio: 'pipe',
        env: {
          ...process.env,
          APP_SECRET:
            process.env.APP_SECRET || '0123456789abcdef0123456789abcdef',
          EXE_LICENSE_KEY:
            process.env.EXE_LICENSE_KEY || 'exe_sk_test_license_key',
          PG_DATABASE_PASSWORD:
            process.env.PG_DATABASE_PASSWORD || 'test_password',
          SERVER_URL: process.env.SERVER_URL || 'https://crm.example.com',
          STORAGE_S3_NAME: process.env.STORAGE_S3_NAME || 'bucket',
        },
      });
    } catch (err) {
      const error = err as NodeJS.ErrnoException & {
        stderr?: Buffer;
        stdout?: Buffer;
      };
      if (error.code === 'ENOENT') {
        expect(compose).toContain(
          'APP_SECRET: "${APP_SECRET:?APP_SECRET is required - generate with openssl rand -base64 32}"',
        );
        expect(compose).toContain(
          'EXE_LICENSE_KEY: "${EXE_LICENSE_KEY:?EXE_LICENSE_KEY is required - purchase at https://askexe.com}"',
        );
        return;
      }
      throw new Error(
        `docker compose config failed: ${error.stderr?.toString() || error.message || error.stdout?.toString()}`,
      );
    }
  });

  it('PG_DATABASE_URL accepts a direct exe-db URL and falls back to parameterized local defaults', () => {
    const matches = compose.match(
      /PG_DATABASE_URL: \$\{PG_DATABASE_URL:-postgres:\/\/\$\{PG_DATABASE_USER:-postgres\}:\$\{PG_DATABASE_PASSWORD:\?Set PG_DATABASE_PASSWORD\}@\$\{PG_DATABASE_HOST:-db\}:\$\{PG_DATABASE_PORT:-5432\}\/\$\{PG_DATABASE_NAME:-default\}\}/g,
    );

    expect(matches?.length).toBe(2);
  });

  it('publishes CRM only on localhost with configurable host port', () => {
    expect(compose).toMatch(
      /-\s+['"]127\.0\.0\.1:\$\{CRM_HOST_PORT:-3000\}:3000['"]/,
    );
  });

  it('requires EXE_LICENSE_KEY in both server and worker env blocks', () => {
    const matches = compose.match(
      /EXE_LICENSE_KEY: ['"]\$\{EXE_LICENSE_KEY:\?EXE_LICENSE_KEY is required - purchase at https:\/\/askexe\.com\}['"]/g,
    );
    expect(matches?.length).toBe(2);
  });

  it('uses CRM_IMAGE_TAG as the stack-update image contract', () => {
    const matches = compose.match(
      /image: ghcr\.io\/askexe\/exe-crm:\$\{CRM_IMAGE_TAG:-v0\.9\.3\}/g,
    );

    expect(matches?.length).toBe(2);
    expect(compose).not.toContain('${TAG:-');
  });

  it('keeps every customer deployment surface pinned to the stack release image', () => {
    const expectedImage = `ghcr.io/askexe/exe-crm:v${stackRelease.version}`;

    expect(stackRelease.image).toBe(expectedImage);
    expect(stackRelease.imageEnv).toBe('CRM_IMAGE_TAG');
    expect(helmChart).toMatch(
      new RegExp(`appVersion: [\'\"]v${stackRelease.version}[\'\"]`),
    );
    expect(k8sServerDeployment).toContain(`image: ${expectedImage}`);
    expect(k8sWorkerDeployment).toContain(`image: ${expectedImage}`);
    expect(podmanManualSteps).toContain(expectedImage);
    expect(
      [
        compose,
        helmChart,
        k8sServerDeployment,
        k8sWorkerDeployment,
        podmanManualSteps,
      ].join('\n'),
    ).not.toMatch(/exe-crm:(2\.2\.0|v1\.14\.0)|docker\.io\/ghcr\.io/);
  });

  it('GoTrue JWT bridge keeps the expected validation imports and helpers', () => {
    expect(accessTokenService).toContain(
      'import { createPublicKey, type JsonWebKey as CryptoJsonWebKey } from',
    );
    expect(accessTokenService).toContain(
      "import * as jwt from 'jsonwebtoken';",
    );
    expect(accessTokenService).toContain(
      'type GoTrueJwtPayload = jwt.JwtPayload & {',
    );
    expect(accessTokenService).toContain('type GoTrueJwk = {');
    expect(accessTokenService).toContain('async verifyGoTrueToken(');
    expect(accessTokenService).toContain('private async fetchGoTrueJwks(');
    expect(accessTokenService).toContain('private getGoTrueVerificationKey(');
    expect(accessTokenService).toContain('return createPublicKey({');
    expect(accessTokenService).toContain(
      'const verified = jwt.verify(token, verificationKey, {',
    );
  });

  // bug 550d6ab7 — GoTrue omits HMAC keys from JWKS by design, so the JWKS-only
  // key lookup made GET /api/auth/gotrue-callback unsatisfiable against a
  // symmetric GoTrue. The shared-secret fallback must stay HS256-gated and must
  // never loosen the issuer/audience/expiry assertions.
  it('GoTrue HS256 shared-secret fallback stays narrowly gated', () => {
    expect(accessTokenService).toContain(
      'private getGoTrueSymmetricVerificationKey(',
    );
    // Fallback is reached only when JWKS yields no key, and only for HS256.
    expect(accessTokenService).toContain(
      ': this.getGoTrueSymmetricVerificationKey(algorithm);',
    );
    expect(accessTokenService).toContain("if (algorithm !== 'HS256') {");
    // Refuses to downgrade an asymmetric deployment (algorithm confusion).
    expect(accessTokenService).toContain('advertisesAsymmetricKey');
    expect(accessTokenService).toContain("(key) => key.kty !== 'oct'");
    // Fails closed when the secret is absent.
    expect(accessTokenService).toContain(
      "this.twentyConfigService.get('GOTRUE_JWT_SECRET')",
    );
    expect(accessTokenService).toMatch(
      /if \(typeof sharedSecret !== 'string' \|\| sharedSecret\.length === 0\) \{[\s\S]*?return null;/,
    );
    // Every original assertion survives.
    expect(accessTokenService).toContain('algorithms: [algorithm],');
    expect(accessTokenService).toContain('audience: this.getGoTrueAudience(),');
    expect(accessTokenService).toContain(
      'issuer: this.getGoTrueIssuers(gotrueUrl),',
    );
    expect(accessTokenService).toContain('ignoreExpiration: false,');
    expect(accessTokenService).toContain('ignoreNotBefore: false,');
    // The secret is never logged.
    expect(accessTokenService).not.toMatch(/log\w*\([^)]*sharedSecret/);
  });
});
