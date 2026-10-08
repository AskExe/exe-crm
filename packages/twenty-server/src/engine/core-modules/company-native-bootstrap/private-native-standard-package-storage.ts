import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  type FileHandle,
} from 'node:fs/promises';

import { getDefaultApplicationPackageFields } from 'src/engine/core-modules/application/application-package/utils/get-default-application-package-fields.util';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeMutationFence } from 'src/engine/core-modules/company-native-bootstrap/private-native-mutation-fence';

type AggregateError = Error & { errors: unknown[] };
declare const AggregateError: new (
  errors: Iterable<unknown>,
  message?: string,
) => AggregateError;

const ROOT = '/app/.local-storage';
const STANDARD = '20202020-64aa-4b6f-b003-9c74b97cee20';
type Directory = { handle: FileHandle; identity: Stats; namedPath: string };
const sameIdentity = (left: Stats, right: Stats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid &&
  left.gid === right.gid &&
  left.mode === right.mode;

// Linux FD-relative mutations never follow a replaced ancestor. All descriptors
// remain owned until terminal closure; failed filesystem writes are quarantined.
export async function writeOriginalStandardPackageFiles(
  fence: PrivateNativeMutationFence,
): Promise<void> {
  PrivateNativeMutationFence.assertIssued(fence);
  if (process.platform !== 'linux') throw new PrivateNativeActionUnavailable();
  const original = await fence.readOriginalWorkspace();
  const fields = await getDefaultApplicationPackageFields();
  await fence.assertCurrent();
  const sources = [
    [
      'package.json',
      fields.packageJsonContent,
      1387,
      '2978b3c39db430c052cb16510464bf1867eab36541bfe5d5604df9cdd7c4acdb',
    ],
    [
      'yarn.lock',
      fields.yarnLockContent,
      112283,
      'c3d3b74359b15c38d072a664691cb0cf18502f0dd70b10344061d6f4a6550637',
    ],
  ] as const;
  for (const [, content, size, hash] of sources)
    if (
      Buffer.byteLength(content) !== size ||
      createHash('sha256').update(content).digest('hex') !== hash
    )
      throw new PrivateNativeActionUnavailable();

  const handles: FileHandle[] = [];
  const directories: Directory[] = [];
  let primary: unknown;
  let failed = false;
  const closure: unknown[] = [];
  const checked = async <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    await fence.assertCurrent();
    const result = await operation();
    await fence.assertCurrent();
    return result;
  };
  const assertDirectories = async () => {
    for (const directory of directories) {
      const held = await checked(() => directory.handle.stat());
      const named = await checked(() => lstat(directory.namedPath));
      if (
        !held.isDirectory() ||
        held.isSymbolicLink() ||
        !named.isDirectory() ||
        named.isSymbolicLink() ||
        !sameIdentity(held, directory.identity) ||
        !sameIdentity(named, directory.identity)
      )
        throw new PrivateNativeActionUnavailable();
    }
    if ((await checked(() => realpath(ROOT))) !== ROOT)
      throw new PrivateNativeActionUnavailable();
  };
  // Open outcomes are retained before the post-await fence so revocation cannot
  // lose an acquired descriptor. Paths below a held parent are kernel-resolved.
  const acquireDirectory = async (path: string): Promise<FileHandle> => {
    await fence.assertCurrent();
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    handles.push(handle);
    await fence.assertCurrent();
    return handle;
  };
  try {
    const root = await checked(() => lstat(ROOT));
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      root.uid !== 1000 ||
      (root.mode & 0o777) !== 0o700
    )
      throw new PrivateNativeActionUnavailable();
    const rootHandle = await acquireDirectory(ROOT);
    const rootHeld = await checked(() => rootHandle.stat());
    if (!sameIdentity(root, rootHeld))
      throw new PrivateNativeActionUnavailable();
    directories.push({
      handle: rootHandle,
      identity: rootHeld,
      namedPath: ROOT,
    });
    await assertDirectories();
    let parent = directories[0];
    for (const [index, component] of [
      original.workspaceId,
      STANDARD,
      'dependencies',
    ].entries()) {
      await assertDirectories();
      const path = `/proc/self/fd/${parent.handle.fd}/${component}`;
      try {
        await checked(() => mkdir(path, { mode: 0o700 }));
      } catch (error) {
        // Only the original workspace parent may preexist from allocation.
        if (index !== 0 || (error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw error;
        await fence.assertCurrent();
      }
      await assertDirectories();
      const handle = await acquireDirectory(path);
      const identity = await checked(() => handle.stat());
      if (
        !identity.isDirectory() ||
        identity.uid !== 1000 ||
        (identity.mode & 0o022) !== 0
      )
        throw new PrivateNativeActionUnavailable();
      const directory = {
        handle,
        identity,
        namedPath: `${parent.namedPath}/${component}`,
      };
      directories.push(directory);
      await assertDirectories();
      parent = directory;
    }
    for (const [name, content, size, hash] of sources) {
      await assertDirectories();
      await fence.assertCurrent();
      const handle = await open(
        `/proc/self/fd/${parent.handle.fd}/${name}`,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      handles.push(handle);
      await fence.assertCurrent();
      const identity = await checked(() => handle.stat());
      if (
        !identity.isFile() ||
        identity.uid !== 1000 ||
        identity.nlink !== 1 ||
        (identity.mode & 0o777) !== 0o600
      )
        throw new PrivateNativeActionUnavailable();
      const assertFile = async () => {
        await assertDirectories();
        const held = await checked(() => handle.stat());
        const named = await checked(() => lstat(`${parent.namedPath}/${name}`));
        if (
          [held, named].some(
            (value) =>
              !value.isFile() ||
              value.isSymbolicLink() ||
              value.nlink !== 1 ||
              !sameIdentity(value, identity),
          )
        )
          throw new PrivateNativeActionUnavailable();
      };
      await assertFile();
      const bytes = Buffer.from(content);
      const written = await checked(() =>
        handle.write(bytes, 0, bytes.length, 0),
      );
      if (written.bytesWritten !== bytes.length)
        throw new PrivateNativeActionUnavailable();
      await assertFile();
      await checked(() => handle.sync());
      await assertFile();
      const readback = Buffer.alloc(size + 1);
      let count = 0;
      while (count < readback.length) {
        const read = await checked(() =>
          handle.read(readback, count, readback.length - count, count),
        );
        if (
          !Number.isInteger(read.bytesRead) ||
          read.bytesRead < 0 ||
          read.bytesRead > readback.length - count
        )
          throw new PrivateNativeActionUnavailable();
        if (read.bytesRead === 0) break;
        count += read.bytesRead;
      }
      if (
        count !== size ||
        createHash('sha256')
          .update(readback.subarray(0, count))
          .digest('hex') !== hash
      )
        throw new PrivateNativeActionUnavailable();
      const final = await checked(() => handle.stat());
      if (final.size !== size) throw new PrivateNativeActionUnavailable();
      await assertFile();
    }
    await assertDirectories();
  } catch (error) {
    primary = error;
    failed = true;
  } finally {
    // Terminal cleanup is independent of a revoked/expired original action.
    for (const handle of handles.reverse()) {
      try {
        await handle.close();
      } catch (error) {
        closure.push(error);
      }
    }
  }
  if (failed) {
    if (closure.length) throw new AggregateError([primary, ...closure]);
    throw primary;
  }
  if (closure.length) throw new AggregateError(closure);
  await fence.assertCurrent();
}
