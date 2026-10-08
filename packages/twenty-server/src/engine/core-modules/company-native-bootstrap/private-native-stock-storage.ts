import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import {
  type Directory,
  same,
  PrivateNativeStockStorageFailure,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-model';
import { PrivateNativeStockStorageDenials } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-denials';
import { STOCK_PACKAGE_INPUTS } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-pins';
export const PRIVATE_NATIVE_STOCK_STORAGE = Symbol(
  'private-native-stock-storage',
);
const ROOT = '/app/.local-storage';
const STANDARD = '20202020-64aa-4b6f-b003-9c74b97cee20';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const issuedStockStorage = new WeakSet<PrivateNativeStockStorage>();

// Fixed stock output only. No uploads, arbitrary folders, deletes or adoption of
// preexisting output files. Failed output stays quarantined with its original DB.
export class PrivateNativeStockStorage extends PrivateNativeStockStorageDenials {
  readonly #directories = new Map<string, Directory>();
  readonly #handles = new Set<FileHandle>();
  readonly #files = new Map<
    string,
    { size: number; hash: string; identity: Stats }
  >();
  #terminal = false;
  #busy = false;
  #bytes = 0;
  private constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
  ) {
    super();
  }

  static async bind(
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<PrivateNativeStockStorage> {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    if (process.platform !== 'linux' || process.getuid?.() !== 1000)
      throw new PrivateNativeActionUnavailable();
    const storage = new PrivateNativeStockStorage(checkpoint);
    try {
      let parent: Directory | undefined;
      for (const [name, named] of [
        ['/', '/'],
        ['app', '/app'],
        ['.local-storage', ROOT],
      ] as const) {
        const before = await lstat(named);
        if (
          !before.isDirectory() ||
          before.isSymbolicLink() ||
          (named === ROOT
            ? before.uid !== 1000 || (before.mode & 0o777) !== 0o700
            : before.uid !== 0 || (before.mode & 0o022) !== 0)
        )
          throw new PrivateNativeActionUnavailable();
        const directory = await storage.acquire(
          parent ? `/proc/self/fd/${parent.handle.fd}/${name}` : '/',
          named,
        );
        if (!same(before, directory.identity))
          throw new PrivateNativeActionUnavailable();
        storage.#directories.set(named, directory);
        parent = directory;
      }
      await storage.bindOriginalPackages();
      await storage.assertCurrent();
      issuedStockStorage.add(storage);
      return storage;
    } catch (primary) {
      const cleanup = await storage.closeHandles();
      throw new PrivateNativeStockStorageFailure(primary, cleanup);
    }
  }

  private async bindOriginalPackages(): Promise<void> {
    await this.checkpoint.assertOriginalCustomPackageMetadata();
    const original = this.checkpoint.pendingPlan.original;
    let parent = this.#directories.get(ROOT)!;
    for (const component of [
      original.workspaceId,
      original.customApplicationId,
      'dependencies',
    ]) {
      await this.assertCurrent();
      const named = `${parent.named}/${component}`;
      const directory = await this.acquire(
        `/proc/self/fd/${parent.handle.fd}/${component}`,
        named,
      );
      if (
        directory.identity.uid !== 1000 ||
        (directory.identity.mode & 0o777) !== 0o700 ||
        directory.identity.dev !== parent.identity.dev
      )
        throw new PrivateNativeActionUnavailable();
      this.#directories.set(named, directory);
      parent = directory;
    }
    const application = this.#directories.get(
      `${ROOT}/${original.workspaceId}/${original.customApplicationId}`,
    )!;
    const appEntries = await readdir(`/proc/self/fd/${application.handle.fd}`);
    const entries = await readdir(`/proc/self/fd/${parent.handle.fd}`);
    await this.assertCurrent();
    if (
      appEntries.length !== 1 ||
      appEntries[0] !== 'dependencies' ||
      entries.sort().join(',') !== 'package.json,yarn.lock'
    )
      throw new PrivateNativeActionUnavailable();
    for (const [name, size, hash] of STOCK_PACKAGE_INPUTS) {
      let handle: FileHandle | undefined;
      let primary: unknown;
      let failed = false;
      const cleanupErrors: unknown[] = [];
      try {
        handle = await open(
          `/proc/self/fd/${parent.handle.fd}/${name}`,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        this.#handles.add(handle);
        await this.assertCurrent();
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.uid !== 1000 ||
          before.nlink !== 1 ||
          (before.mode & 0o777) !== 0o600 ||
          before.size !== size ||
          before.dev !== parent.identity.dev
        )
          throw new PrivateNativeActionUnavailable();
        const bytes = Buffer.alloc(size);
        const read = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat();
        await this.assertCurrent();
        if (
          !same(before, after) ||
          after.nlink !== 1 ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          read.bytesRead !== size ||
          createHash('sha256').update(bytes).digest('hex') !== hash
        )
          throw new PrivateNativeActionUnavailable();
        this.#files.set(
          `${original.workspaceId}/${original.customApplicationId}/dependencies/${name}`,
          { size, hash, identity: after },
        );
      } catch (error) {
        failed = true;
        primary = error;
      } finally {
        if (handle) {
          try {
            await handle.close();
            this.#handles.delete(handle);
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
      }
      if (failed || cleanupErrors.length)
        throw new PrivateNativeStockStorageFailure(
          failed ? primary : new PrivateNativeActionUnavailable(),
          cleanupErrors,
        );
    }
    await this.checkpoint.assertOriginalCustomPackageMetadata();
  }

  static assertIssued(storage: PrivateNativeStockStorage): void {
    if (!issuedStockStorage.has(storage) || storage.#terminal)
      throw new PrivateNativeActionUnavailable();
  }

  assertCheckpoint(checkpoint: PrivateNativeStockActionCheckpoint): void {
    PrivateNativeStockStorage.assertIssued(this);
    if (checkpoint !== this.checkpoint)
      throw new PrivateNativeActionUnavailable();
  }

  private async acquire(path: string, named: string): Promise<Directory> {
    await this.checkpoint.assertCurrent();
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    this.#handles.add(handle);
    await this.checkpoint.assertCurrent();
    const identity = await handle.stat();
    await this.checkpoint.assertCurrent();
    if (!identity.isDirectory()) throw new PrivateNativeActionUnavailable();
    return { handle, identity, named };
  }

  private async assertCurrent(): Promise<void> {
    if (this.#terminal) throw new PrivateNativeActionUnavailable();
    await this.checkpoint.assertCurrent();
    for (const directory of this.#directories.values()) {
      const held = await directory.handle.stat();
      await this.checkpoint.assertCurrent();
      const named = await lstat(directory.named);
      await this.checkpoint.assertCurrent();
      if (
        !same(held, directory.identity) ||
        !same(named, directory.identity) ||
        !named.isDirectory()
      )
        throw new PrivateNativeActionUnavailable();
    }
  }

  private components(filePath: string): string[] {
    const original = this.checkpoint.pendingPlan.original;
    const components = filePath.split('/');
    const [workspace, application, folder, ...leaf] = components;
    if (
      workspace !== original.workspaceId ||
      ![STANDARD, original.customApplicationId].includes(application) ||
      components.length > 8 ||
      components.some(
        (part) =>
          !/^[a-zA-Z0-9_.-]{1,128}$/.test(part) ||
          part === '.' ||
          part === '..',
      ) ||
      !(
        (folder === 'dependencies' &&
          leaf.length === 1 &&
          ['package.json', 'yarn.lock'].includes(leaf[0])) ||
        (folder === 'generated-sdk-client' &&
          leaf.length === 1 &&
          leaf[0] === 'twenty-client-sdk.zip') ||
        (folder === 'source' &&
          leaf.length > 0 &&
          leaf[leaf.length - 1]?.endsWith('.ts'))
      )
    )
      throw new PrivateNativeActionUnavailable();
    return components;
  }

  private async parent(components: string[]): Promise<Directory> {
    let parent = this.#directories.get(ROOT)!;
    for (const [index, component] of components.entries()) {
      const named = `${parent.named}/${component}`;
      let directory = this.#directories.get(named);
      if (!directory) {
        await this.assertCurrent();
        const anchored = `/proc/self/fd/${parent.handle.fd}/${component}`;
        try {
          await mkdir(anchored, { mode: 0o700 });
        } catch (error) {
          if (index !== 0 || (error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error;
        }
        await this.assertCurrent();
        directory = await this.acquire(anchored, named);
        if (
          directory.identity.uid !== 1000 ||
          (directory.identity.mode & 0o777) !== 0o700 ||
          directory.identity.dev !== parent.identity.dev
        )
          throw new PrivateNativeActionUnavailable();
        this.#directories.set(named, directory);
      }
      parent = directory;
    }
    await this.assertCurrent();
    return parent;
  }

  async writeFile({
    filePath,
    sourceFile,
  }: {
    filePath: string;
    sourceFile: Buffer | Uint8Array | string;
    mimeType?: string;
  }): Promise<void> {
    if (this.#busy) throw new PrivateNativeActionUnavailable();
    this.#busy = true;
    let handle: FileHandle | undefined;
    let primary: unknown;
    let failed = false;
    const cleanupErrors: unknown[] = [];
    try {
      const components = this.components(filePath);
      const content = Buffer.from(sourceFile);
      if (
        !content.length ||
        content.length > MAX_FILE_BYTES ||
        this.#bytes + content.length > MAX_TOTAL_BYTES ||
        this.#files.has(filePath)
      )
        throw new PrivateNativeActionUnavailable();
      this.#bytes += content.length;
      const parent = await this.parent(components.slice(0, -1));
      await this.assertCurrent();
      handle = await open(
        `/proc/self/fd/${parent.handle.fd}/${components[components.length - 1]}`,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      this.#handles.add(handle);
      await this.assertCurrent();
      const identity = await handle.stat();
      if (
        !identity.isFile() ||
        identity.nlink !== 1 ||
        identity.uid !== 1000 ||
        (identity.mode & 0o777) !== 0o600
      )
        throw new PrivateNativeActionUnavailable();
      const written = await handle.write(content, 0, content.length, 0);
      await this.assertCurrent();
      if (written.bytesWritten !== content.length)
        throw new PrivateNativeActionUnavailable();
      await handle.sync();
      await this.assertCurrent();
      const readback = Buffer.alloc(content.length);
      const read = await handle.read(readback, 0, readback.length, 0);
      await this.assertCurrent();
      const final = await handle.stat();
      const hash = createHash('sha256').update(content).digest('hex');
      if (
        read.bytesRead !== content.length ||
        !readback.equals(content) ||
        !same(identity, final) ||
        final.nlink !== 1 ||
        final.size !== content.length
      )
        throw new PrivateNativeActionUnavailable();
      this.#files.set(filePath, {
        size: content.length,
        hash,
        identity: final,
      });
    } catch (error) {
      this.#terminal = true;
      failed = true;
      primary = error;
    } finally {
      this.#busy = false;
      if (handle) {
        try {
          await handle.close();
          this.#handles.delete(handle);
        } catch (error) {
          cleanupErrors.push(error);
          this.#terminal = true;
        }
      }
    }
    if (failed || cleanupErrors.length)
      throw new PrivateNativeStockStorageFailure(
        failed ? primary : cleanupErrors[0],
        cleanupErrors,
      );
  }

  async readFile({ filePath }: { filePath: string }): Promise<Readable> {
    if (this.#busy) throw new PrivateNativeActionUnavailable();
    await this.assertCurrent();
    this.components(filePath);
    const expected = this.#files.get(filePath);
    if (!expected) throw new PrivateNativeActionUnavailable();
    const components = filePath.split('/');
    const parent = this.#directories.get(
      `${ROOT}/${components.slice(0, -1).join('/')}`,
    )!;
    this.#busy = true;
    let handle: FileHandle | undefined;
    let primary: unknown;
    let failed = false;
    let result: Readable | undefined;
    const cleanupErrors: unknown[] = [];
    try {
      handle = await open(
        `/proc/self/fd/${parent.handle.fd}/${components[components.length - 1]}`,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      this.#handles.add(handle);
      await this.assertCurrent();
      const bytes = Buffer.alloc(expected.size);
      const read = await handle.read(bytes, 0, bytes.length, 0);
      const identity = await handle.stat();
      await this.assertCurrent();
      if (
        !same(identity, expected.identity) ||
        identity.size !== expected.size ||
        identity.nlink !== 1 ||
        read.bytesRead !== expected.size ||
        createHash('sha256').update(bytes).digest('hex') !== expected.hash
      )
        throw new PrivateNativeActionUnavailable();
      result = Readable.from([bytes]);
    } catch (error) {
      failed = true;
      primary = error;
      this.#terminal = true;
    } finally {
      if (handle) {
        try {
          await handle.close();
          this.#handles.delete(handle);
        } catch (error) {
          cleanupErrors.push(error);
          this.#terminal = true;
        }
      }
      this.#busy = false;
    }
    if (failed || cleanupErrors.length)
      throw new PrivateNativeStockStorageFailure(
        failed ? primary : cleanupErrors[0],
        cleanupErrors,
      );
    if (!result) throw new PrivateNativeActionUnavailable();
    return result;
  }

  async checkFileExists({ filePath }: { filePath: string }): Promise<boolean> {
    await this.assertCurrent();
    this.components(filePath);
    return this.#files.has(filePath);
  }
  async checkFolderExists({
    folderPath,
  }: {
    folderPath: string;
  }): Promise<boolean> {
    await this.assertCurrent();
    return this.#directories.has(`${ROOT}/${folderPath}`);
  }
  outputReadManifest(checkpoint: PrivateNativeStockActionCheckpoint) {
    this.assertCheckpoint(checkpoint);
    if (this.#busy) throw new PrivateNativeActionUnavailable();
    const original = checkpoint.pendingPlan.original;
    for (const application of [STANDARD, original.customApplicationId]) {
      for (const leaf of [
        'dependencies/package.json',
        'dependencies/yarn.lock',
        'generated-sdk-client/twenty-client-sdk.zip',
      ]) {
        if (!this.#files.has(`${original.workspaceId}/${application}/${leaf}`))
          throw new PrivateNativeActionUnavailable();
      }
    }
    return Object.freeze({
      directories: Object.freeze(
        [...this.#directories].map(([path, directory]) =>
          Object.freeze({ path, identity: Object.freeze(directory.identity) }),
        ),
      ),
      files: Object.freeze(
        [...this.#files].map(([path, file]) =>
          Object.freeze({
            path,
            ...file,
            identity: Object.freeze(file.identity),
          }),
        ),
      ),
    });
  }

  private async closeHandles(): Promise<unknown[]> {
    this.#terminal = true;
    const errors: unknown[] = [];
    for (const handle of [...this.#handles].reverse()) {
      try {
        await handle.close();
        this.#handles.delete(handle);
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
  async close(): Promise<void> {
    if (this.#busy) throw new PrivateNativeActionUnavailable();
    const errors = await this.closeHandles();
    if (errors.length)
      throw new PrivateNativeStockStorageFailure(errors[0], errors.slice(1));
  }
}
