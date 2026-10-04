import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  rmSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';

export const readSourceFile = (file) => {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1)
      throw Error('Unsupported source file');
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

export const digest = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const git = (repository, args) =>
  execFileSync('git', ['--no-replace-objects', '-C', repository, ...args], {
    maxBuffer: 32 * 1024 * 1024,
  });

export const sourceEntries = (repository, sha) => {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    git(repository, ['cat-file', '-t', sha]).toString().trim() !== 'commit'
  )
    throw Error('Exact source commit required');
  const entries = new Map();
  const raw = git(repository, ['ls-tree', '-r', '-z', '--full-tree', sha]);
  const decoded = raw.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(raw))
    throw Error('Unsupported source path encoding');
  for (const row of decoded.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match)
      throw Error(
        'Source symlinks, submodules or unsupported entries are forbidden',
      );
    const [, mode, oid, path] = match;
    if (
      path.startsWith('/') ||
      /[\\\x00-\x1f\x7f]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw Error('Unsafe source path');
    entries.set(path, { mode, oid });
  }
  return entries;
};

export const verifySourceDirectory = (
  directory,
  entries,
  derived = new Map(),
) => {
  const found = new Set();
  const visit = (relative = '') => {
    for (const name of readdirSync(join(directory, relative))) {
      const path = relative ? relative + '/' + name : name;
      const file = join(directory, path);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Source symlink forbidden');
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1)
        throw Error('Unsupported source file');
      const bytes = readSourceFile(file);
      const expected = entries.get(path);
      if (expected) {
        const oid = createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex');
        if (
          oid !== expected.oid ||
          (stat.mode & 0o7777) !== (expected.mode === '100755' ? 0o755 : 0o644)
        )
          throw Error('Archive source differs from commit');
      } else if (!derived.has(path) || digest(bytes) !== derived.get(path)) {
        throw Error('Untracked or altered build context file');
      }
      found.add(path);
    }
  };
  visit();
  if (
    found.size !== entries.size + derived.size ||
    [...entries.keys(), ...derived.keys()].some((path) => !found.has(path))
  )
    throw Error('Archive omitted committed source');
};

export const archiveSource = (repository, sha, directory, tar) => {
  const entries = sourceEntries(repository, sha);
  mkdirSync(directory);
  git(repository, ['archive', '--format=tar', '--output', tar, sha]);
  const archiveDigest = digest(readSourceFile(tar));
  execFileSync('tar', ['-xf', tar, '-C', directory]);
  rmSync(tar);
  verifySourceDirectory(directory, entries);
  return {
    entries,
    archiveDigest,
    tree: git(repository, ['rev-parse', sha + '^{tree}'])
      .toString()
      .trim(),
  };
};

export const fixtureDockerfile = (original, lockDigest) => {
  if (!/^[a-f0-9]{64}$/.test(lockDigest ?? ''))
    throw Error('Exact source lock digest required');
  const marker = 'FROM common-deps AS twenty-front-build';
  const focus =
    'RUN yarn workspaces focus --production twenty-emails twenty-shared twenty-sdk twenty-client-sdk twenty-server';
  const base =
    'FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS common-deps';
  if (
    original.split(marker).length !== 2 ||
    original.split(focus).length !== 2 ||
    !original.startsWith('#') ||
    !original.includes(base)
  )
    throw Error('Unexpected native Dockerfile recipe');
  const server = original.slice(0, original.indexOf(marker));
  if (
    server
      .split('\n')
      .filter((line) => line.startsWith('FROM '))
      .join('\n') !==
    base + '\nFROM common-deps AS twenty-server-build'
  )
    throw Error('Unexpected native build bases');
  if (
    !server.includes('FROM common-deps AS twenty-server-build') ||
    !server.includes('RUN npx nx run twenty-server:build') ||
    !server.includes(focus)
  )
    throw Error('Unexpected native server build');
  const dependencyInstall = 'RUN yarn && yarn cache clean && npx nx reset';
  if (server.split(dependencyInstall).length !== 2)
    throw Error('Unexpected native dependency install');
  const additionalWorkspaces = [
    'twenty-utils',
    'twenty-zapier',
    'twenty-e2e-testing',
    'twenty-cli',
    'create-twenty-app',
    'twenty-oxlint-rules',
    'twenty-companion',
  ];
  const completeServer = server.replace(
    dependencyInstall,
    additionalWorkspaces
      .map(
        (name) => `COPY ./packages/${name}/package.json /app/packages/${name}/`,
      )
      .join('\n') +
      '\n\n' +
      dependencyInstall,
  );
  const checkedServer = completeServer.replace(
    'FROM common-deps AS twenty-server-build',
    `RUN node -e 'const fs=require("fs"),crypto=require("crypto");if(crypto.createHash("sha256").update(fs.readFileSync("/app/yarn.lock")).digest("hex")!=="${lockDigest}")throw Error("Fixture lock changed during dependency install")'\n\nFROM common-deps AS twenty-server-build`,
  );
  return (
    checkedServer.replace(focus, '') +
    `
FROM twenty-server-build AS company-server-fixture
RUN apk add --no-cache --upgrade curl jq postgresql-client libcrypto3 libssl3
COPY ./packages/twenty-docker/twenty/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/.local-storage /app/packages/twenty-server/.local-storage && chown 1000:1000 /app/.local-storage /app/packages/twenty-server/.local-storage
WORKDIR /app/packages/twenty-server
USER 1000
CMD ["node", "dist/main"]
ENTRYPOINT ["/app/entrypoint.sh"]
`
  );
};
