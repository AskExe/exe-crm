import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveSource,
  verifySourceDirectory,
  sourceEntries,
  fixtureDockerfile,
  digest,
} from './company-read-source.mjs';

const fixture = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'owned-crm-source-review-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args],
      { encoding: 'utf8' },
    ).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Owned fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(
      join(root, 'runtime.ts'),
      'export const value = "committed";\n',
    );
    const commit = () => {
      git('add', '-A');
      git('commit', '-qm', 'owned synthetic fixture');
      return git('rev-parse', 'HEAD');
    };
    const sha = commit();
    run({
      root,
      git,
      commit,
      sha,
      archive: (source = sha) =>
        archiveSource(
          root,
          source,
          join(root, 'archive'),
          join(root, 'archive.tar'),
        ),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('uses committed blobs despite dirty/untracked runtime and checkout symlinks', () =>
  fixture(({ root, sha, archive }) => {
    writeFileSync(join(root, 'canary'), 'host-only-untracked');
    rmSync(join(root, 'runtime.ts'));
    symlinkSync(join(root, 'canary'), join(root, 'runtime.ts'));
    writeFileSync(join(root, 'untracked-runtime.ts'), 'dirty code');
    const snapshot = archive();
    assert.equal(
      readFileSync(join(root, 'archive/runtime.ts'), 'utf8'),
      'export const value = "committed";\n',
    );
    assert.equal(existsSync(join(root, 'archive/canary')), false);
    assert.equal(existsSync(join(root, 'archive/untracked-runtime.ts')), false);
    assert.match(snapshot.tree, /^[a-f0-9]{40}$/);
    assert.match(snapshot.archiveDigest, /^[a-f0-9]{64}$/);
    assert.equal(sourceEntries(root, sha).size, 1);
  }));

test('ignores repository replace refs when resolving the labelled source commit', () =>
  fixture(({ root, git, commit, sha, archive }) => {
    writeFileSync(join(root, 'runtime.ts'), 'replacement code');
    const other = commit();
    git('replace', sha, other);
    archive(sha);
    assert.equal(
      readFileSync(join(root, 'archive/runtime.ts'), 'utf8'),
      'export const value = "committed";\n',
    );
  }));

test('rejects committed source symlinks before extraction', () =>
  fixture(({ root, commit, archive }) => {
    symlinkSync('/nonexistent/private-host-source', join(root, 'native-link'));
    assert.throws(() => archive(commit()), /symlinks/);
    assert.equal(existsSync(join(root, 'archive')), false);
  }));

test('rejects committed submodule entries', () =>
  fixture(({ root, git, sha, archive }) => {
    git(
      'update-index',
      '--add',
      '--cacheinfo',
      '160000,' + sha + ',native-submodule',
    );
    git('commit', '-qm', 'owned submodule fixture');
    assert.throws(() => archive(git('rev-parse', 'HEAD')), /submodules/);
    assert.equal(existsSync(join(root, 'archive')), false);
  }));

test('rejects export-ignore and export-subst changes to commit bytes', () => {
  fixture(({ root, commit, archive }) => {
    writeFileSync(join(root, '.gitattributes'), 'runtime.ts export-ignore\n');
    assert.throws(() => archive(commit()), /omitted/);
  });
  fixture(({ root, commit, archive }) => {
    writeFileSync(join(root, '.gitattributes'), 'runtime.ts export-subst\n');
    writeFileSync(join(root, 'runtime.ts'), '$Format:%H$\n');
    assert.throws(() => archive(commit()), /differs/);
  });
});

test('rejects altered source, executable bits, extra runtime and source symlinks after extraction', () =>
  fixture(({ root, archive }) => {
    const snapshot = archive(),
      dir = join(root, 'archive'),
      file = join(dir, 'runtime.ts');
    const bytes = readFileSync(file);
    writeFileSync(file, 'dirty');
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries),
      /differs/,
    );
    writeFileSync(file, bytes);
    chmodSync(file, 0o755);
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries),
      /differs/,
    );
    chmodSync(file, 0o4644);
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries),
      /differs/,
    );
    chmodSync(file, 0o644);
    writeFileSync(join(dir, 'extra-runtime.ts'), 'dirty');
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries),
      /Untracked/,
    );
    rmSync(join(dir, 'extra-runtime.ts'));
    rmSync(file);
    symlinkSync(join(root, 'runtime.ts'), file);
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries),
      /symlink/,
    );
  }));

test('permits only the digested derived recipe and rejects changing it', () =>
  fixture(({ root, archive }) => {
    const snapshot = archive(),
      dir = join(root, 'archive'),
      recipe = 'reviewed fixture recipe';
    writeFileSync(join(dir, 'Dockerfile.server-fixture'), recipe);
    const derived = new Map([['Dockerfile.server-fixture', digest(recipe)]]);
    verifySourceDirectory(dir, snapshot.entries, derived);
    writeFileSync(join(dir, 'Dockerfile.server-fixture'), 'changed');
    assert.throws(
      () => verifySourceDirectory(dir, snapshot.entries, derived),
      /altered/,
    );
  }));

test('requires the exact bounded native recipe and labels retained dev tooling variant', () => {
  const original = readFileSync(
    new URL('../../packages/twenty-docker/twenty/Dockerfile', import.meta.url),
    'utf8',
  );
  const lockDigest = digest(
    readFileSync(new URL('../../yarn.lock', import.meta.url)),
  );
  const recipe = fixtureDockerfile(original, lockDigest);
  assert.ok(recipe.includes(lockDigest));
  assert.match(recipe, /Fixture lock changed during dependency install/);
  assert.throws(() => fixtureDockerfile(original), /lock digest/);
  for (const name of [
    'twenty-utils',
    'twenty-zapier',
    'twenty-e2e-testing',
    'twenty-cli',
    'create-twenty-app',
    'twenty-oxlint-rules',
    'twenty-companion',
  ]) {
    const copy = `COPY ./packages/${name}/package.json /app/packages/${name}/`;
    assert.equal(recipe.split(copy).length, 2);
    assert.ok(
      recipe.indexOf(copy) <
        recipe.indexOf('RUN yarn && yarn cache clean && npx nx reset'),
    );
    assert.ok(
      readFileSync(
        new URL(`../../packages/${name}/package.json`, import.meta.url),
      ).length > 0,
    );
  }
  assert.doesNotMatch(recipe, /COPY .*twenty-apps\/package\.json/);
  assert.match(recipe, /RUN npx nx run twenty-server:build/);
  assert.match(recipe, /USER 1000/);
  assert.match(recipe, /ENTRYPOINT \["\/app\/entrypoint.sh"\]/);
  assert.doesNotMatch(recipe, /workspaces focus --production/);
  assert.doesNotMatch(recipe, /FROM common-deps AS twenty-front-build/);
  for (const changed of [
    original.replace('FROM common-deps AS twenty-front-build', ''),
    original.replace(
      'RUN yarn workspaces focus --production',
      'RUN changed focus --production',
    ),
    original.replace('AS common-deps', 'AS foreign-base'),
    original.replace(
      'RUN yarn && yarn cache clean && npx nx reset',
      'RUN changed install',
    ),
  ])
    assert.throws(() => fixtureDockerfile(changed, lockDigest), /Unexpected/);
});

test('rejects a tree object as a purported source commit', () =>
  fixture(({ root, git, sha }) => {
    const tree = git('rev-parse', sha + '^{tree}');
    assert.throws(
      () =>
        archiveSource(
          root,
          tree,
          join(root, 'archive'),
          join(root, 'archive.tar'),
        ),
      /source commit/,
    );
    assert.equal(existsSync(join(root, 'archive')), false);
  }));
