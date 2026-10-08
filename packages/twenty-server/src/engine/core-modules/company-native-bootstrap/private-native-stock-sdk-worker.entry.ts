import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';

import { stop } from 'esbuild';
import { replaceCoreClient } from 'twenty-client-sdk/generate';

import { createZipFile } from 'src/engine/core-modules/logic-function/logic-function-drivers/utils/create-zip-file';
import {
  decodePrivateStockSdkRequest,
  STOCK_SDK_MAX_ARCHIVE_BYTES,
  STOCK_SDK_MAX_REQUEST_BYTES,
  STOCK_SDK_MAX_RESULT_BYTES,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-protocol';

const ROOT = '/tmp/stock-sdk';
const PACKAGE = '/app/dist/assets/twenty-client-sdk';

// Invoked only in the parent's fixed read-only image with a bounded tmpfs,
// network none, no host binds and no SQL/Core/parent credential environment.
const main = async (): Promise<void> => {
  if (
    process.platform !== 'linux' ||
    process.getuid?.() !== 1000 ||
    Object.keys(process.env).some((key) =>
      /(?:TOKEN|PASSWORD|SECRET|DATABASE|PG_|REDIS|BROKER|PARENT)/i.test(key),
    )
  )
    throw new Error('stock_sdk_runtime_refused');
  const temporary = await lstat('/tmp');
  const assets = await lstat(PACKAGE);
  if (
    !temporary.isDirectory() ||
    temporary.isSymbolicLink() ||
    !assets.isDirectory() ||
    assets.isSymbolicLink() ||
    assets.uid !== 0 ||
    assets.mode & 0o022
  )
    throw new Error('stock_sdk_root_refused');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > STOCK_SDK_MAX_REQUEST_BYTES)
      throw new Error('stock_sdk_request_bound');
    chunks.push(bytes);
  }
  const request = decodePrivateStockSdkRequest(Buffer.concat(chunks));
  await mkdir(ROOT, { mode: 0o700 });
  const packageRoot = path.join(ROOT, 'twenty-client-sdk');
  let packageBytes = 0;
  const inspect = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'src') continue;
      const named = path.join(directory, entry.name);
      const identity = await lstat(named);
      if (
        identity.isSymbolicLink() ||
        identity.uid !== 0 ||
        identity.mode & 0o022
      )
        throw new Error('stock_sdk_package_refused');
      if (identity.isDirectory()) await inspect(named);
      else if (identity.isFile() && identity.nlink === 1) {
        packageBytes += identity.size;
        if (packageBytes > 16 * 1024 * 1024)
          throw new Error('stock_sdk_package_bound');
      } else throw new Error('stock_sdk_package_refused');
    }
  };
  await inspect(PACKAGE);
  await cp(PACKAGE, packageRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    filter: (source) =>
      !path
        .relative(PACKAGE, source)
        .split(path.sep)
        .some((part) => part === 'node_modules' || part === 'src'),
  });
  // Native generator progress must not contaminate the one canonical reply.
  const originalWrite = process.stdout.write;
  process.stdout.write = (
    buffer: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const args = callback
      ? [buffer, encodingOrCallback, callback]
      : encodingOrCallback
        ? [buffer, encodingOrCallback]
        : [buffer];
    return Reflect.apply(process.stderr.write, process.stderr, args);
  };
  let archive: Buffer;
  try {
    await replaceCoreClient({ packageRoot, schema: request.schema });
    const archivePath = path.join(ROOT, 'twenty-client-sdk.zip');
    await createZipFile(packageRoot, archivePath);
    const handle = await open(
      archivePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.uid !== 1000 ||
        before.nlink !== 1 ||
        !before.size ||
        before.size > STOCK_SDK_MAX_ARCHIVE_BYTES
      )
        throw new Error('stock_sdk_archive_bound');
      archive = Buffer.alloc(before.size);
      const read = await handle.read(archive, 0, archive.length, 0);
      if (read.bytesRead !== archive.length)
        throw new Error('stock_sdk_archive_incomplete');
      const after = await handle.stat();
      if (
        archive.length !== before.size ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        !after.isFile() ||
        after.uid !== 1000 ||
        after.nlink !== 1 ||
        before.size !== after.size ||
        before.mode !== after.mode ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error('stock_sdk_archive_changed');
    } finally {
      await handle.close();
    }
  } finally {
    process.stdout.write = originalWrite;
    stop();
  }
  const result = Buffer.from(
    JSON.stringify({
      version: 1,
      actionId: request.actionId,
      workspaceId: request.workspaceId,
      applicationId: request.applicationId,
      applicationUniversalIdentifier: request.applicationUniversalIdentifier,
      archiveBytes: archive.length,
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      archiveBase64: archive.toString('base64'),
    }) + '\n',
  );
  if (result.length > STOCK_SDK_MAX_RESULT_BYTES)
    throw new Error('stock_sdk_result_bound');
  await new Promise<void>((resolve, reject) =>
    originalWrite.call(process.stdout, result, (error?: Error | null) =>
      error ? reject(error) : resolve(),
    ),
  );
};

void main().catch(() => {
  // Fixed public classification only; schema and SDK diagnostics stay in the
  // parent's bounded private capture, never authority/provisioning receipts.
  process.stderr.write('stock_sdk_worker_failed\n');
  process.exitCode = 1;
  stop();
});
