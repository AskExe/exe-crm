import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { assertStockObservedFileProjection } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-model';
import { PrivateNativeStockStorage } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage';

const same = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.uid === b.uid &&
  a.gid === b.gid &&
  a.mode === b.mode;
const issued = new WeakSet<PrivateNativeStockOutputObserver>();
type Manifest = ReturnType<PrivateNativeStockStorage['outputReadManifest']>;

// Independently reopen and hash the exact issued output ledger after SQL role
// withdrawal. Neither database file metadata nor successful writes replace this
// observation. It exposes no path/hash selectors or filesystem write operation.
export class PrivateNativeStockOutputObserver {
  #used = false;
  private constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
    private readonly manifest: Manifest,
  ) {}

  static bind(
    checkpoint: PrivateNativeStockActionCheckpoint,
    storage: PrivateNativeStockStorage,
  ) {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    PrivateNativeStockStorage.assertIssued(storage);
    storage.assertCheckpoint(checkpoint);
    const observer = new PrivateNativeStockOutputObserver(
      checkpoint,
      storage.outputReadManifest(checkpoint),
    );
    issued.add(observer);
    return observer;
  }

  async observe() {
    if (
      !issued.has(this) ||
      this.#used ||
      process.platform !== 'linux' ||
      process.getuid?.() !== 1000
    )
      throw new PrivateNativeActionUnavailable();
    this.#used = true;
    const handles: FileHandle[] = [];
    const directories = new Map<string, FileHandle>();
    const observed: { path: string; bytes: number; sha256: string }[] = [];
    let primary: unknown;
    let failed = false;
    const cleanupErrors: unknown[] = [];
    try {
      for (const expected of this.manifest.directories) {
        await this.checkpoint.assertCurrent();
        const parentPath =
          expected.path.slice(0, expected.path.lastIndexOf('/')) || '/';
        const parent = directories.get(parentPath);
        const name = expected.path.slice(expected.path.lastIndexOf('/') + 1);
        const anchored =
          expected.path === '/' ? '/' : `/proc/self/fd/${parent?.fd}/${name}`;
        if (expected.path !== '/' && !parent)
          throw new PrivateNativeActionUnavailable();
        const handle = await open(
          anchored,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        handles.push(handle);
        const held = await handle.stat();
        const named = await lstat(expected.path);
        await this.checkpoint.assertCurrent();
        if (
          !held.isDirectory() ||
          !same(held, expected.identity) ||
          !same(named, expected.identity)
        )
          throw new PrivateNativeActionUnavailable();
        directories.set(expected.path, handle);
      }
      let total = 0;
      for (const expected of this.manifest.files) {
        await this.checkpoint.assertCurrent();
        total += expected.size;
        if (
          expected.size <= 0 ||
          expected.size > 32 * 1024 * 1024 ||
          total > 128 * 1024 * 1024
        )
          throw new PrivateNativeActionUnavailable();
        const split = expected.path.lastIndexOf('/');
        const parent = directories.get(
          `/app/.local-storage/${expected.path.slice(0, split)}`,
        );
        if (!parent) throw new PrivateNativeActionUnavailable();
        const handle = await open(
          `/proc/self/fd/${parent.fd}/${expected.path.slice(split + 1)}`,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        handles.push(handle);
        const before = await handle.stat();
        await this.checkpoint.assertCurrent();
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          !same(before, expected.identity) ||
          before.size !== expected.size
        )
          throw new PrivateNativeActionUnavailable();
        const bytes = Buffer.alloc(expected.size);
        const read = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat();
        const named = await lstat(`/app/.local-storage/${expected.path}`);
        await this.checkpoint.assertCurrent();
        const hash = createHash('sha256').update(bytes).digest('hex');
        assertStockObservedFileProjection(
          before,
          after,
          named,
          expected.size,
          read.bytesRead,
          hash,
          expected.hash,
        );
        observed.push({
          path: expected.path,
          bytes: expected.size,
          sha256: hash,
        });
      }
      // Recheck every ancestor's held-vs-named identity after all asynchronous
      // reads. A renamed namespace cannot qualify another current path.
      for (const expected of this.manifest.directories) {
        const held = await directories.get(expected.path)!.stat();
        const named = await lstat(expected.path);
        await this.checkpoint.assertCurrent();
        if (!same(held, expected.identity) || !same(named, expected.identity))
          throw new PrivateNativeActionUnavailable();
      }
    } catch (error) {
      failed = true;
      primary = error;
    } finally {
      for (const handle of handles.reverse()) {
        try {
          await handle.close();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    if (failed || cleanupErrors.length)
      throw new PrivateNativeStockOutputUncertain(
        failed ? primary : cleanupErrors[0],
        Object.freeze(cleanupErrors),
      );
    await this.checkpoint.assertCurrent();
    return Object.freeze(observed.map((row) => Object.freeze(row)));
  }
}
export class PrivateNativeStockOutputUncertain extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private stock filesystem observation requires quarantine');
  }
}
