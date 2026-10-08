import { type Stats } from 'node:fs';
import { type FileHandle } from 'node:fs/promises';
import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

export type Directory = { handle: FileHandle; identity: Stats; named: string };
export const same = (left: Stats, right: Stats) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid &&
  left.gid === right.gid &&
  left.mode === right.mode;

export class PrivateNativeStockStorageFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly cleanupErrors: readonly unknown[],
  ) {
    super('Private stock storage requires quarantine and closure');
  }
}

// Exact post-read held/named projection, shared only by the fixed observer.
// This check is not a filesystem handle or read authority.
export function assertStockObservedFileProjection(
  before: Stats,
  after: Stats,
  named: Stats,
  expectedSize: number,
  bytesRead: number,
  actualHash: string,
  expectedHash: string,
): void {
  if (
    bytesRead !== expectedSize ||
    !same(before, after) ||
    !same(after, named) ||
    after.size !== expectedSize ||
    after.nlink !== 1 ||
    named.nlink !== 1 ||
    named.size !== expectedSize ||
    named.mtimeMs !== after.mtimeMs ||
    after.mtimeMs !== before.mtimeMs ||
    actualHash !== expectedHash
  )
    throw new PrivateNativeActionUnavailable();
}
