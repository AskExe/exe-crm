import { constants, readFileSync } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { type DataSource } from 'typeorm';

import {
  PrivateNativeActionReader,
  PrivateNativeActionUnavailable,
  type PrivateNativeActionTuple,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeDatabaseGuard } from 'src/engine/core-modules/company-native-bootstrap/private-native-database-guard';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';
import { writeOriginalStandardPackageFiles } from 'src/engine/core-modules/company-native-bootstrap/private-native-standard-package-storage';

type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

jest.mock('node:fs/promises', () => ({
  lstat: jest.fn(),
  mkdir: jest.fn(),
  open: jest.fn(),
  realpath: jest.fn(),
}));
jest.mock(
  'src/engine/core-modules/application/application-package/utils/get-default-application-package-fields.util',
  () => ({
    getDefaultApplicationPackageFields: jest.fn(() => {
      const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
      const path =
        __dirname +
        '/../application/application-package/constants/seed-dependencies/';
      return {
        packageJsonContent: fs.readFileSync(path + 'package.json', 'utf8'),
        yarnLockContent: fs.readFileSync(path + 'yarn.lock', 'utf8'),
      };
    }),
  }),
);

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const tuple: PrivateNativeActionTuple = {
  job_id: id('1'),
  lease_token: id('2'),
  attempt: 1,
  worker_id: 'controlled',
  company_id: id('3'),
  deployment_id: id('4'),
  product: 'crm-workspace',
  profile_sha256: '1'.repeat(64),
  config_sha256: '2'.repeat(64),
  initializer_sha256: '3'.repeat(64),
  request_key: id('5'),
  intent_id: id('6'),
  action_id: id('7'),
};
const workspaceId = id('9');
const owner = id('8');
const root = '/app/.local-storage';
const directory = `${root}/${workspaceId}/20202020-64aa-4b6f-b003-9c74b97cee20/dependencies`;

// Inert Linux FD API model; actual kernel semantics require the separate Linux plan.
describe('fixed original standard package storage with held directory FDs', () => {
  type Node = {
    ino: number;
    uid: number;
    gid: number;
    mode: number;
    nlink: number;
    content: Buffer;
    directory: boolean;
    symlink: boolean;
    children: Map<string, Node>;
  };
  let rootNode: Node;
  let nodes: Map<number, Node>;
  let descriptors: Map<number, Node>;
  let closed: number[];
  let next: number;
  let revoked: boolean;
  let onOpen: ((path: string, node: Node) => void) | undefined;
  let onWrite: ((node: Node) => void) | undefined;
  let closeFailures: Map<number, Error>;
  let shortWrite: boolean;
  let corruptRead: boolean;
  const platform = process.platform;
  const create = (directory: boolean): Node => ({
    ino: next++,
    uid: 1000,
    gid: 1000,
    mode: directory ? 0o40700 : 0o100600,
    nlink: directory ? 2 : 1,
    content: Buffer.alloc(0),
    directory,
    symlink: false,
    children: new Map(),
  });
  const stat = (node: Node) => ({
    dev: 1,
    ino: node.ino,
    uid: node.uid,
    gid: node.gid,
    mode: node.mode,
    nlink: node.nlink,
    size: node.content.length,
    isDirectory: () => node.directory,
    isFile: () => !node.directory,
    isSymbolicLink: () => node.symlink,
  });
  const resolve = (path: string): Node => {
    const fd = /^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/.exec(path);
    let node = fd ? descriptors.get(Number(fd[1]))! : rootNode;
    const parts = fd
      ? (fd[2] || '').split('/').filter(Boolean)
      : path.slice(root.length).split('/').filter(Boolean);
    if (!node) throw Object.assign(new Error('controlled'), { code: 'EBADF' });
    for (const part of parts) {
      node = node.children.get(part)!;
      if (!node)
        throw Object.assign(new Error('controlled'), { code: 'ENOENT' });
    }
    return node;
  };
  async function issued() {
    const { lease_token: _secret, ...projection } = tuple;
    const worker = {
      query: jest.fn(async () => {
        if (revoked) throw new PrivateNativeActionUnavailable();
        return [
          {
            authority: {
              ...projection,
              owner_subject: owner,
              sql_time: '2026-10-08T00:00:00.000Z',
              lease_expires_at: '2026-10-08T00:10:00.000Z',
            },
          },
        ];
      }),
    } as unknown as DataSource;
    const native = {
      query: jest.fn(async (sql: string) =>
        sql.includes('JOIN core.')
          ? [
              {
                actionId: tuple.action_id,
                workspaceId,
                userId: id('a'),
                userWorkspaceId: id('b'),
                applicationId: id('c'),
                ownerSubject: owner,
                databaseSchema: null,
              },
            ]
          : [{ actionId: tuple.action_id }],
      ),
    } as unknown as DataSource;
    return PrivateNativeMutationFence.bindCommittedMarker(
      native,
      new PrivateNativeActionReader(worker, true),
      tuple,
      owner,
      performance.now() + 10000,
      performance.now() + 120000,
      61000,
      'controlled_writer',
    );
  }
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    next = 1;
    rootNode = create(true);
    nodes = new Map();
    descriptors = new Map();
    closed = [];
    revoked = false;
    onOpen = undefined;
    onWrite = undefined;
    closeFailures = new Map();
    shortWrite = false;
    corruptRead = false;
    jest
      .spyOn(PrivateNativeDatabaseGuard.prototype, 'assertCurrent')
      .mockResolvedValue();
    jest.mocked(realpath).mockImplementation(async (path) => String(path));
    jest
      .mocked(lstat)
      .mockImplementation(async (path) => stat(resolve(String(path))) as never);
    jest.mocked(mkdir).mockImplementation(async (path) => {
      const name = String(path),
        parent = resolve(name.slice(0, name.lastIndexOf('/'))),
        leaf = name.slice(name.lastIndexOf('/') + 1);
      if (parent.children.has(leaf))
        throw Object.assign(new Error('controlled'), { code: 'EEXIST' });
      parent.children.set(leaf, create(true));
      return undefined;
    });
    jest.mocked(open).mockImplementation(async (path, flags) => {
      const name = String(path);
      let node: Node;
      if ((Number(flags) & constants.O_CREAT) !== 0) {
        const parent = resolve(name.slice(0, name.lastIndexOf('/'))),
          leaf = name.slice(name.lastIndexOf('/') + 1);
        if (parent.children.has(leaf))
          throw Object.assign(new Error('controlled'), { code: 'EEXIST' });
        node = create(false);
        parent.children.set(leaf, node);
      } else node = resolve(name);
      if (node.symlink)
        throw Object.assign(new Error('controlled'), { code: 'ELOOP' });
      const fd = next++;
      descriptors.set(fd, node);
      nodes.set(fd, node);
      onOpen?.(name, node);
      return {
        fd,
        stat: jest.fn(async () => stat(node)),
        write: jest.fn(
          async (buffer: Buffer, offset: number, length: number) => {
            const count = shortWrite ? length - 1 : length;
            node.content = Buffer.from(buffer.subarray(offset, offset + count));
            onWrite?.(node);
            return { bytesWritten: count, buffer };
          },
        ),
        sync: jest.fn(async () => undefined),
        read: jest.fn(
          async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            const count = Math.min(
              length,
              Math.max(0, node.content.length - position),
            );
            node.content.copy(buffer, offset, position, position + count);
            if (corruptRead && count) buffer[offset] ^= 1;
            return { bytesRead: count, buffer };
          },
        ),
        close: jest.fn(async () => {
          closed.push(fd);
          descriptors.delete(fd);
          if (closeFailures.has(fd)) throw closeFailures.get(fd);
        }),
      } as never;
    });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
  });
  const allClosed = () => {
    expect(descriptors.size).toBe(0);
    expect(closed).toHaveLength(nodes.size);
  };
  it('uses only held-parent relative mutations and verifies both fixed payloads from held file FDs', async () => {
    await writeOriginalStandardPackageFiles(await issued());
    expect(mkdir).toHaveBeenCalledTimes(3);
    for (const [path] of jest.mocked(mkdir).mock.calls)
      expect(String(path)).toMatch(/^\/proc\/self\/fd\/\d+\//);
    const calls = jest.mocked(open).mock.calls;
    expect(calls).toHaveLength(6);
    expect(calls[0][0]).toBe(root);
    for (const call of calls.slice(1, 4))
      expect(Number(call[1])).toBe(
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    for (const call of calls.slice(4))
      expect(Number(call[1])).toBe(
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
      );
    expect(resolve(directory + '/package.json').content).toEqual(
      readFileSync(
        __dirname +
          '/../application/application-package/constants/seed-dependencies/package.json',
      ),
    );
    expect(resolve(directory + '/yarn.lock').content).toEqual(
      readFileSync(
        __dirname +
          '/../application/application-package/constants/seed-dependencies/yarn.lock',
      ),
    );
    allClosed();
  });
  it('does not issue filesystem work for an unissued fence', async () => {
    await expect(
      writeOriginalStandardPackageFiles({} as PrivateNativeMutationFence),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(open).not.toHaveBeenCalled();
  });
  it.each(['symlink', 'wrong-owner', 'wrong-mode'])(
    'rejects %s root before descriptor acquisition',
    async (kind) => {
      if (kind === 'symlink') rootNode.symlink = true;
      if (kind === 'wrong-owner') rootNode.uid = 999;
      if (kind === 'wrong-mode') rootNode.mode = 0o40755;
      await expect(
        writeOriginalStandardPackageFiles(await issued()),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      expect(open).not.toHaveBeenCalled();
    },
  );
  it('allows only the action-derived existing workspace parent, never an existing standard directory', async () => {
    const workspace = create(true),
      standard = create(true);
    rootNode.children.set(workspaceId, workspace);
    workspace.children.set('20202020-64aa-4b6f-b003-9c74b97cee20', standard);
    await expect(
      writeOriginalStandardPackageFiles(await issued()),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(standard.children.size).toBe(0);
    allClosed();
  });
  it('parent replacement cannot redirect FD-relative creation into a foreign directory', async () => {
    const foreign = create(true);
    let originalParent: Node | undefined;
    onOpen = (path) => {
      if (path.endsWith('/package.json')) {
        originalParent = resolve(directory);
        resolve(
          root + '/' + workspaceId + '/20202020-64aa-4b6f-b003-9c74b97cee20',
        ).children.set('dependencies', foreign);
      }
    };
    await expect(
      writeOriginalStandardPackageFiles(await issued()),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(foreign.children.size).toBe(0);
    expect(originalParent!.children.get('package.json')!.content.length).toBe(
      0,
    );
    allClosed();
  });
  it('retains acquired FD before post-open revocation and closes every original descriptor', async () => {
    onOpen = (path) => {
      if (path.endsWith('/package.json')) revoked = true;
    };
    await expect(
      writeOriginalStandardPackageFiles(await issued()),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    allClosed();
  });
  it.each(['short-write', 'corrupt-read', 'hardlink', 'revoked-after-write'])(
    'refuses %s before SQL commit',
    async (kind) => {
      if (kind === 'short-write') shortWrite = true;
      if (kind === 'corrupt-read') corruptRead = true;
      if (kind === 'hardlink')
        onWrite = (node) => {
          node.nlink = 2;
        };
      if (kind === 'revoked-after-write')
        onWrite = () => {
          revoked = true;
        };
      await expect(
        writeOriginalStandardPackageFiles(await issued()),
      ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
      allClosed();
    },
  );
  it('preserves primary failure plus every descriptor closure error without skipping later closes', async () => {
    const failures = [new Error('close-one'), new Error('close-two')];
    onOpen = (path) => {
      if (path.endsWith('/package.json')) {
        revoked = true;
        const ids = [...descriptors.keys()];
        closeFailures.set(ids[0], failures[0]);
        closeFailures.set(ids[1], failures[1]);
      }
    };
    let error: unknown;
    try {
      await writeOriginalStandardPackageFiles(await issued());
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors;
    expect(errors[0]).toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(errors).toContain(failures[0]);
    expect(errors).toContain(failures[1]);
    allClosed();
  });
});
