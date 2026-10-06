import {
  archiveSource,
  digest,
  fixtureDockerfile,
  readSourceFile,
  verifySourceDirectory,
} from './company-read-source.mjs';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  statfsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const sha = process.argv[2],
  repo = resolve(fileURLToPath(new URL('../..', import.meta.url))),
  id = randomUUID(),
  tag = 'exe-company-native-crm-server:' + id;
if (!/^[a-f0-9]{40}$/.test(sha ?? ''))
  throw Error('Exact reviewed source SHA required');
const root = mkdtempSync(join(tmpdir(), 'owned-crm-server-source-'));
const config = join(root, 'docker-config');
mkdirSync(config, { mode: 0o700 });
writeFileSync(
  join(config, 'config.json'),
  JSON.stringify({
    cliPluginsExtraDirs: [
      '/Applications/Docker.app/Contents/Resources/cli-plugins',
    ],
  }),
  { mode: 0o600 },
);
const env = {
  ...process.env,
  DOCKER_CONFIG: config,
  DOCKER_HOST: 'unix:///Users/exeai/.docker/run/docker.sock',
};
const free = () => {
  const s = statfsSync(root);
  return (s.bavail * s.bsize) / 1024 ** 3;
};
try {
  if (free() < 20) throw Error('disk floor');
  const dir = join(root, 'source');
  const snapshot = archiveSource(repo, sha, dir, join(root, 'source.tar'));
  const original = readSourceFile(
    join(dir, 'packages/twenty-docker/twenty/Dockerfile'),
  ).toString('utf8');
  const dockerfile = fixtureDockerfile(
    original,
    digest(readSourceFile(join(dir, 'yarn.lock'))),
  );
  writeFileSync(join(dir, 'Dockerfile.server-fixture'), dockerfile);
  verifySourceDirectory(
    dir,
    snapshot.entries,
    new Map([['Dockerfile.server-fixture', digest(dockerfile)]]),
  );
  console.log(
    `Exact server-only source ${sha}; tag ${tag}; free ${free().toFixed(2)}GiB`,
  );
  const child = spawn(
    'docker',
    [
      'build',
      '--label',
      `org.exe.fixture_source_sha=${sha}`,
      '--label',
      `org.exe.fixture_source_tree=${snapshot.tree}`,
      '--label',
      `org.exe.fixture_archive_sha256=${snapshot.archiveDigest}`,
      '--label',
      `org.exe.fixture_dockerfile_sha256=${digest(dockerfile)}`,
      '--label',
      'org.exe.disposable_company_fixture=true',
      '--label',
      'org.exe.fixture_scope=dev-dependency-server-only',
      '--label',
      'org.opencontainers.image.description=Disposable compiled CRM backend-only authorization fixture with locked development tooling; no production admission',
      '-f',
      join(dir, 'Dockerfile.server-fixture'),
      '-t',
      tag,
      dir,
    ],
    { env, stdio: 'inherit' },
  );
  let floor = false;
  const deadline = setTimeout(() => child.kill('SIGINT'), 3600000);
  const timer = setInterval(() => {
    if (free() < 20 && !floor) {
      floor = true;
      console.error('Owned build stopping at20GiB floor');
      child.kill('SIGINT');
    }
  }, 1000);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  clearInterval(timer);
  clearTimeout(deadline);
  if (code !== 0 || floor) throw Error('build stopped');
  const image = execFileSync(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', tag],
    { env, encoding: 'utf8' },
  ).trim();
  writeFileSync(
    resolve(process.argv[3] ?? '/tmp/exe-owned-crm-company-images.json'),
    JSON.stringify(
      {
        version: 1,
        fixture_id: id,
        source_tree: snapshot.tree,
        archive_sha256: snapshot.archiveDigest,
        native_dockerfile_sha256: digest(original),
        fixture_dockerfile_sha256: digest(dockerfile),
        builder_sha256: digest(readSourceFile(fileURLToPath(import.meta.url))),
        source_guard_sha256: digest(
          readSourceFile(
            fileURLToPath(
              new URL('./company-read-source.mjs', import.meta.url),
            ),
          ),
        ),
        productionReady: false,
        verified: false,
        scope: 'dev-dependency-server-only',
        images: [
          {
            kind: 'crm',
            source_sha: sha,
            image,
            owned_tag: tag,
            scope: 'dev-dependency-server-only',
          },
        ],
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    `Source-built server-only image ${image}; free ${free().toFixed(2)}GiB`,
  );
} catch (e) {
  console.error(`Owned server-only build failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
