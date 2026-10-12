import { readFileSync, type Stats } from 'node:fs';
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import { PrivateNativeStockStorage } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage';
import { PrivateNativeStockStorageFailure } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-storage-model';

jest.mock('node:fs/promises', () => ({
  lstat: jest.fn(),
  open: jest.fn(),
  readdir: jest.fn(),
}));
jest.mock('src/engine/core-modules/application/application.entity', () => ({
  ApplicationEntity: class {},
}));

// This exercises storage bind, not Linux kernel semantics or SQL authority.
describe('stock storage bind diagnostics', () => {
  const root = '/app/.local-storage';
  const workspace = `${root}/workspace`;
  const application = `${workspace}/custom`;
  const dependencies = `${application}/dependencies`;
  const platform = process.platform;
  const primary = new Error('postgresql://sentinel-secret@private');
  const cleanup = new Error('private-cleanup-secret');
  let diagnostic: { stage: string };
  let failureStage: string | undefined;
  let failClose: boolean;
  let afterOpen: boolean;
  let corruptHash: boolean;
  let checkpoint: PrivateNativeStockActionCheckpoint;
  let descriptors: Map<number, string>;
  let nodes: Map<string, Stats>;
  let handles: FileHandle[];
  let bytes: Map<string, Buffer>;

  const resolve = (path: string) => {
    const match = /^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/.exec(path);
    if (!match) return path;
    const parent = descriptors.get(Number(match[1]))!;
    return match[2] ? `${parent === '/' ? '' : parent}/${match[2]}` : parent;
  };
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    jest.spyOn(process, 'getuid').mockReturnValue(1000);
    diagnostic = { stage: 'stock-prepare-storage' };
    failureStage = undefined;
    failClose = false;
    afterOpen = false;
    corruptHash = false;
    descriptors = new Map();
    handles = [];
    bytes = new Map(
      ['package.json', 'yarn.lock'].map((name) => [
        `${dependencies}/${name}`,
        readFileSync(
          `${__dirname}/../application/application-package/constants/seed-dependencies/${name}`,
        ),
      ]),
    );
    nodes = new Map(
      [
        '/',
        '/app',
        root,
        workspace,
        application,
        dependencies,
        ...bytes.keys(),
      ].map((path, index) => {
        const file = bytes.get(path);
        return [
          path,
          {
            dev: 1,
            ino: index + 1,
            uid: index < 2 ? 0 : 1000,
            gid: index < 2 ? 0 : 1000,
            mode: file ? 0o100600 : index < 2 ? 0o40755 : 0o40700,
            nlink: file ? 1 : 2,
            size: file?.length ?? 0,
            mtimeMs: 1,
            isDirectory: () => !file,
            isFile: () => Boolean(file),
            isSymbolicLink: () => false,
          } as Stats,
        ];
      }),
    );
    checkpoint = {
      pendingPlan: {
        original: { workspaceId: 'workspace', customApplicationId: 'custom' },
      },
      assertCurrent: jest.fn(async (currentDiagnostic?: { stage: string }) => {
        if (afterOpen && handles.length) {
          if (currentDiagnostic)
            currentDiagnostic.stage = 'stock-storage-current-core-authority';
          throw primary;
        }
      }),
      assertOriginalCustomPackageMetadata: jest.fn(
        async (currentDiagnostic?: { stage: string }) => {
          const previous = currentDiagnostic?.stage;
          if (currentDiagnostic)
            currentDiagnostic.stage = 'stock-storage-metadata';
          if (failureStage === 'stock-storage-metadata') throw primary;
          if (currentDiagnostic && previous) currentDiagnostic.stage = previous;
        },
      ),
    } as unknown as PrivateNativeStockActionCheckpoint;
    jest
      .spyOn(PrivateNativeStockActionCheckpoint, 'assertIssued')
      .mockImplementation(() => {
        if (failureStage === 'stock-storage-issued') throw primary;
      });
    jest.mocked(lstat).mockImplementation(async (path) => {
      const named = resolve(String(path));
      const ancestors = new Map([
        ['/', 'root'],
        ['/app', 'app'],
        [root, 'local'],
      ]);
      if (
        failureStage === `stock-storage-ancestor-${ancestors.get(named)}` ||
        (failureStage === 'stock-storage-directory-current' &&
          named === '/' &&
          handles.length > 0)
      )
        throw primary;
      return nodes.get(named)!;
    });
    jest.mocked(readdir).mockImplementation(async (path) => {
      if (failureStage === 'stock-storage-entries') throw primary;
      return (
        resolve(String(path)) === application
          ? ['dependencies']
          : ['package.json', 'yarn.lock']
      ) as never;
    });
    jest.mocked(open).mockImplementation(async (path) => {
      const named = resolve(String(path));
      const families = new Map([
        [workspace, 'directory-workspace'],
        [application, 'directory-custom'],
        [dependencies, 'directory-dependencies'],
        [`${dependencies}/package.json`, 'file-package'],
        [`${dependencies}/yarn.lock`, 'file-lock'],
      ]);
      if (failureStage === `stock-storage-${families.get(named)}`)
        throw primary;
      const fd = handles.length + 10;
      descriptors.set(fd, named);
      const handle = {
        fd,
        stat: jest.fn(async () => nodes.get(named)!),
        read: jest.fn(async (buffer: Buffer) => {
          const content = bytes.get(named)!;
          content.copy(buffer);
          if (corruptHash) buffer[0] ^= 1;
          return { bytesRead: content.length, buffer };
        }),
        close: jest.fn(async () => {
          if (failClose) {
            failClose = false;
            throw cleanup;
          }
        }),
      } as unknown as FileHandle;
      handles.push(handle);
      return handle;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it.each([true, false])(
    'binds actual pinned input bytes with diagnostic=%s and releases diagnostic ownership',
    async (enabled) => {
      const storage = await PrivateNativeStockStorage.bind(
        checkpoint,
        enabled ? diagnostic : undefined,
      );
      PrivateNativeStockStorage.assertIssued(storage);
      expect(diagnostic.stage).toBe('stock-prepare-storage');
      diagnostic.stage = 'stock-prepare-channel';
      await storage.close();
      expect(diagnostic.stage).toBe('stock-prepare-channel');
      expect(
        handles.every(
          (handle) => jest.mocked(handle.close).mock.calls.length === 1,
        ),
      ).toBe(true);
    },
  );

  it.each([
    'issued',
    'ancestor-root',
    'ancestor-app',
    'ancestor-local',
    'metadata',
    'directory-workspace',
    'directory-custom',
    'directory-dependencies',
    'directory-current',
    'entries',
    'file-package',
    'file-lock',
  ])(
    'retains fixed %s failure and closes every acquired descriptor',
    async (family) => {
      failureStage = `stock-storage-${family}`;
      const error = await PrivateNativeStockStorage.bind(
        checkpoint,
        diagnostic,
      ).catch((value) => value);
      expect(diagnostic.stage).toBe(failureStage);
      if (family === 'issued') expect(error).toBe(primary);
      else {
        expect(error).toBeInstanceOf(PrivateNativeStockStorageFailure);
        const nested = error.primary;
        expect(
          nested instanceof PrivateNativeStockStorageFailure
            ? nested.primary
            : nested,
        ).toBe(primary);
      }
      expect(
        handles.every(
          (handle) => jest.mocked(handle.close).mock.calls.length === 1,
        ),
      ).toBe(true);
      expect(JSON.stringify(diagnostic)).not.toContain('secret');
    },
  );

  it('preserves refusal and closure without an optional diagnostic', async () => {
    corruptHash = true;
    const error = await PrivateNativeStockStorage.bind(checkpoint).catch(
      (value) => value,
    );
    expect(error.primary.primary).toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    expect(error.primary.cleanupErrors).toEqual([]);
    expect(diagnostic.stage).toBe('stock-prepare-storage');
    expect(
      handles.every(
        (handle) => jest.mocked(handle.close).mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it('labels runtime rejection before opening any path', async () => {
    jest.mocked(process.getuid!).mockReturnValue(0);
    await expect(
      PrivateNativeStockStorage.bind(checkpoint, diagnostic),
    ).rejects.toBeInstanceOf(PrivateNativeActionUnavailable);
    expect(diagnostic.stage).toBe('stock-storage-runtime');
    expect(open).not.toHaveBeenCalled();
  });

  it('retains deepest post-open currentness failure and closes its acquired descriptor', async () => {
    afterOpen = true;
    const error = await PrivateNativeStockStorage.bind(
      checkpoint,
      diagnostic,
    ).catch((value) => value);
    expect(error.primary).toBe(primary);
    expect(diagnostic.stage).toBe('stock-storage-current-core-authority');
    expect(handles).toHaveLength(1);
    expect(handles[0].close).toHaveBeenCalledTimes(1);
  });

  it('uses close family only for lone input-handle close failure', async () => {
    failClose = true;
    const error = await PrivateNativeStockStorage.bind(
      checkpoint,
      diagnostic,
    ).catch((value) => value);
    expect(error.primary.cleanupErrors).toEqual([cleanup]);
    expect(diagnostic.stage).toBe('stock-storage-file-close');
    expect(
      handles.every(
        (handle) => jest.mocked(handle.close).mock.calls.length >= 1,
      ),
    ).toBe(true);
  });

  it('preserves file refusal and its family when cleanup also fails', async () => {
    corruptHash = true;
    failClose = true;
    const error = await PrivateNativeStockStorage.bind(
      checkpoint,
      diagnostic,
    ).catch((value) => value);
    expect(error.primary.primary).toBeInstanceOf(
      PrivateNativeActionUnavailable,
    );
    expect(error.primary.cleanupErrors).toEqual([cleanup]);
    expect(diagnostic.stage).toBe('stock-storage-file-package');
    expect(JSON.stringify(diagnostic)).not.toContain('secret');
  });

  it.each(['owner', 'mode', 'symlink'])(
    'continues refusing hostile ancestor %s',
    async (field) => {
      const node = nodes.get(root)!;
      if (field === 'owner') node.uid = 0;
      if (field === 'mode') node.mode = 0o40777;
      if (field === 'symlink') node.isSymbolicLink = () => true;
      await expect(
        PrivateNativeStockStorage.bind(checkpoint, diagnostic),
      ).rejects.toBeInstanceOf(PrivateNativeStockStorageFailure);
      expect(diagnostic.stage).toBe('stock-storage-ancestor-local');
    },
  );
});
