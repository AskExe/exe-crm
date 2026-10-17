import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const installer = path.join(root, 'packages/twenty-docker/scripts/install.sh');
// Synthetic metadata fixtures, never published image pins or credentials.
const digest = `sha256:${'a'.repeat(64)}`;
const otherDigest = `sha256:${'b'.repeat(64)}`;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runInstaller(
  overrides: Record<string, string | undefined> = {},
  start = false,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-installer-digest-'));
  temporaryDirectories.push(directory);
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  const dockerLog = path.join(directory, 'docker.log');
  writeFileSync(dockerLog, '');
  const stubs = {
    docker: `#!/bin/bash
printf '%s\\n' "$*" >> "$INSTALLER_DOCKER_LOG"
case "$*" in
  'compose version --short') echo '2.39.1' ;;
  'compose version'|'info') exit 0 ;;
  'compose up -d')
    printf 'compose-pin %s@%s\\n' "$CRM_IMAGE_TAG" "$CRM_IMAGE_DIGEST" >> "$INSTALLER_DOCKER_LOG"
    # Stop the fixture immediately after observing Compose's actual inputs.
    exit 73
    ;;
  'buildx imagetools inspect ghcr.io/askexe/exe-crm:'*)
    [ "\${INSTALLER_REGISTRY_FAIL:-0}" = 0 ] || exit 1
    printf 'Name: registry-fixture\\nDigest: %s\\nManifests:\\n  Digest: %s\\n' "$INSTALLER_REGISTRY_DIGEST" "$INSTALLER_CHILD_DIGEST"
    ;;
  *) echo 'Unexpected Docker operation' >&2; exit 1 ;;
esac
`,
    curl: `#!/bin/bash
case "$*" in
  *stack.release.json) cat "$INSTALLER_ROOT/stack.release.json" ;;
  *docker-compose.yml) cp "$INSTALLER_ROOT/packages/twenty-docker/docker-compose.yml" docker-compose.yml ;;
  *.env.example)
    if [ "\${INSTALLER_EXAMPLE_MISSING:-0}" = 1 ]; then
      awk '$0 !~ /^CRM_IMAGE_(TAG|DIGEST)=/' "$INSTALLER_ROOT/packages/twenty-docker/.env.example" > .env
    else
      cp "$INSTALLER_ROOT/packages/twenty-docker/.env.example" .env
      printf '\\nCRM_IMAGE_TAG=old-tag\\nCRM_IMAGE_DIGEST=old-digest\\n' >> .env
    fi
    ;;
  *) echo 'Unexpected network operation' >&2; exit 1 ;;
esac
`,
    openssl:
      '#!/bin/bash\necho config-only-secret-fixture-config-only-secret-fixture\n',
    nc: '#!/bin/bash\nexit 1\n',
    'docker-compose': '#!/bin/bash\necho 2.39.1\n',
  };
  for (const [name, source] of Object.entries(stubs)) {
    writeFileSync(path.join(bin, name), source, { mode: 0o755 });
  }
  const result = spawnSync('bash', [installer], {
    cwd: directory,
    encoding: 'utf8',
    input: start ? '\ny\n' : '\nn\n',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BRANCH: 'fixture-branch',
      VERSION: '',
      CRM_IMAGE_TAG: '',
      CRM_IMAGE_DIGEST: digest,
      EXE_LICENSE_KEY: 'config-only-license-fixture',
      INSTALLER_ROOT: root,
      INSTALLER_DOCKER_LOG: dockerLog,
      INSTALLER_REGISTRY_DIGEST: digest,
      INSTALLER_CHILD_DIGEST: otherDigest,
      INSTALLER_REGISTRY_FAIL: '0',
      INSTALLER_EXAMPLE_MISSING: '0',
      ...overrides,
    },
  });
  if (result.error) throw result.error;
  return {
    ...result,
    installation: path.join(directory, 'exe-crm'),
    dockerCalls: readFileSync(dockerLog, 'utf8'),
  };
}

describe('standalone CRM installer digest contract', () => {
  it.each([
    undefined,
    '',
    'sha256:short',
    otherDigest.replace('sha256:', 'sha512:'),
    `${digest}\nBAD=value`,
  ])(
    'rejects missing or malformed operator digest %s before creating configuration',
    (value) => {
      const result = runInstaller({ CRM_IMAGE_DIGEST: value });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('CRM_IMAGE_DIGEST is required');
      expect(existsSync(result.installation)).toBe(false);
      expect(result.dockerCalls).not.toContain('imagetools');
    },
  );

  it.each([
    { INSTALLER_REGISTRY_DIGEST: otherDigest },
    { INSTALLER_REGISTRY_DIGEST: '' },
    { INSTALLER_REGISTRY_FAIL: '1' },
  ])('rejects a mismatched or unverifiable selected tag: %j', (overrides) => {
    const result = runInstaller(overrides);
    expect(result.status).not.toBe(0);
    expect(existsSync(result.installation)).toBe(false);
    expect(result.dockerCalls).not.toContain('compose up');
  });

  it.each([
    [
      {},
      JSON.parse(readFileSync(path.join(root, 'stack.release.json'), 'utf8'))
        .version,
    ],
    [{ CRM_IMAGE_TAG: 'operator-tag' }, 'operator-tag'],
    [{ VERSION: 'legacy-operator-tag' }, 'legacy-operator-tag'],
    [
      { CRM_IMAGE_TAG: 'preferred-tag', VERSION: 'ignored-tag' },
      'preferred-tag',
    ],
  ])(
    'persists the verified pair for selected input %j before deferred Compose',
    (overrides, selected) => {
      const result = runInstaller(overrides);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const expectedTag = Object.keys(overrides).length
        ? selected
        : `v${selected}`;
      const env = readFileSync(path.join(result.installation, '.env'), 'utf8');
      expect(env.match(/^CRM_IMAGE_TAG=.*$/gm)).toEqual([
        `CRM_IMAGE_TAG=${expectedTag}`,
      ]);
      expect(env.match(/^CRM_IMAGE_DIGEST=.*$/gm)).toEqual([
        `CRM_IMAGE_DIGEST=${digest}`,
      ]);
      expect(env).toContain('APP_SECRET=');
      expect(env).toContain('PG_DATABASE_PASSWORD=');
      expect(env).toContain('EXE_LICENSE_KEY=config-only-license-fixture');
      expect(result.dockerCalls).toContain(
        `buildx imagetools inspect ghcr.io/askexe/exe-crm:${expectedTag}`,
      );
      expect(result.dockerCalls).not.toContain('compose up');
    },
  );

  it('rejects a malformed selected tag before registry access or writing .env', () => {
    const result = runInstaller({ CRM_IMAGE_TAG: 'bad/tag&value' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('CRM_IMAGE_TAG must be a valid image tag');
    expect(existsSync(result.installation)).toBe(false);
    expect(result.dockerCalls).not.toContain('imagetools');
  });

  it.each(['0', '1'])(
    'passes the persisted verified pair to immediate Compose even with an empty exported tag (missing example inputs: %s)',
    (missing) => {
      const result = runInstaller(
        {
          VERSION: 'operator-tag',
          CRM_IMAGE_TAG: '',
          INSTALLER_EXAMPLE_MISSING: missing,
        },
        true,
      );
      expect(result.status, result.stdout + result.stderr).toBe(73);
      const env = readFileSync(path.join(result.installation, '.env'), 'utf8');
      expect(env.match(/^CRM_IMAGE_TAG=.*$/gm)).toEqual([
        'CRM_IMAGE_TAG=operator-tag',
      ]);
      expect(env.match(/^CRM_IMAGE_DIGEST=.*$/gm)).toEqual([
        `CRM_IMAGE_DIGEST=${digest}`,
      ]);
      expect(result.dockerCalls).toContain(
        `compose-pin operator-tag@${digest}`,
      );
    },
  );

  it('declares standalone image inputs together in operator configuration metadata', () => {
    const release = JSON.parse(
      readFileSync(path.join(root, 'stack.release.json'), 'utf8'),
    );
    expect(release.stackParticipation.config.requiredEnv).toEqual(
      expect.arrayContaining(['CRM_IMAGE_TAG', 'CRM_IMAGE_DIGEST']),
    );
    expect(release.stackParticipation.config.note).toContain(
      'standalone Docker Compose and Podman Compose',
    );
    expect(release.stackParticipation.config.note).toContain(
      'Managed signed-stack references',
    );
  });
});
