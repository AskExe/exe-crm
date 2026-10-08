import { createHash } from 'node:crypto';
import { fstatSync } from 'node:fs';
import { Socket } from 'node:net';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { PrivateNativeStockActionCheckpoint } from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-action-checkpoint';
import {
  STOCK_SDK_MAX_ARCHIVE_BYTES,
  STOCK_SDK_MAX_REQUEST_BYTES,
  STOCK_SDK_MAX_RESULT_BYTES,
  type PrivateStockSdkRequest,
} from 'src/engine/core-modules/company-native-bootstrap/private-native-stock-sdk-protocol';

const issued = new WeakSet<PrivateNativeStockSdkChannel>();
const RESULT_KEYS = [
  'actionId',
  'applicationId',
  'applicationUniversalIdentifier',
  'archiveBase64',
  'archiveBytes',
  'archiveSha256',
  'version',
  'workspaceId',
];

// The fixed parent owns execution and original-end clipping. These two inherited
// pipes cannot select a process, image, endpoint, timeout or public callback.
export class PrivateNativeStockSdkChannel {
  #busy = false;
  #terminal = false;
  #requests = 0;
  readonly #transportErrors: Error[] = [];
  readonly #request = new Socket({ fd: 3, readable: false, writable: true });
  readonly #response = new Socket({ fd: 4, readable: true, writable: false });
  #buffer = Buffer.alloc(0);
  private constructor(
    private readonly checkpoint: PrivateNativeStockActionCheckpoint,
  ) {
    this.#response.pause();
    const refused = (error: Error) => {
      this.#terminal = true;
      this.#transportErrors.push(error);
    };
    this.#request.on('error', refused);
    this.#response.on('error', refused);
  }

  static async bind(
    checkpoint: PrivateNativeStockActionCheckpoint,
  ): Promise<PrivateNativeStockSdkChannel> {
    PrivateNativeStockActionCheckpoint.assertIssued(checkpoint);
    if (process.platform !== 'linux' || process.getuid?.() !== 1000)
      throw new PrivateNativeActionUnavailable();
    for (const descriptor of [3, 4]) {
      const identity = fstatSync(descriptor);
      if (!identity.isSocket() || identity.uid !== 1000)
        throw new PrivateNativeActionUnavailable();
    }
    await checkpoint.assertCurrent();
    const channel = new PrivateNativeStockSdkChannel(checkpoint);
    issued.add(channel);
    return channel;
  }

  static assertIssued(channel: PrivateNativeStockSdkChannel): void {
    if (!issued.has(channel) || channel.#terminal)
      throw new PrivateNativeActionUnavailable();
  }

  assertCheckpoint(checkpoint: PrivateNativeStockActionCheckpoint): void {
    PrivateNativeStockSdkChannel.assertIssued(this);
    if (checkpoint !== this.checkpoint)
      throw new PrivateNativeActionUnavailable();
  }

  private async transfer(bytes: Buffer, writing: boolean): Promise<void> {
    await this.checkpoint.assertCurrent();
    const remaining = this.checkpoint.remainingOriginalWorkMilliseconds();
    if (remaining <= 0 || this.#terminal)
      throw new PrivateNativeActionUnavailable();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new PrivateNativeActionUnavailable()),
        remaining,
      );
      const finish = (error?: Error | null) => {
        clearTimeout(timer);
        this.#response.pause();
        this.#response.removeListener('readable', readable);
        this.#response.removeListener('end', ended);
        this.#response.removeListener('error', finish);
        this.#request.removeListener('error', finish);
        if (error) reject(error);
        else resolve();
      };
      const ended = () => finish(new PrivateNativeActionUnavailable());
      const readable = () => {
        while (this.#buffer.length < bytes.length) {
          const part: unknown = this.#response.read(
            bytes.length - this.#buffer.length,
          );
          if (part === null) return;
          if (!Buffer.isBuffer(part))
            return finish(new PrivateNativeActionUnavailable());
          this.#buffer = Buffer.concat([this.#buffer, part]);
        }
        if (this.#buffer.length !== bytes.length)
          return finish(new PrivateNativeActionUnavailable());
        this.#buffer.copy(bytes);
        this.#buffer = Buffer.alloc(0);
        finish();
      };
      this.#response.once('error', finish);
      this.#request.once('error', finish);
      if (writing) this.#request.write(bytes, finish);
      else {
        this.#response.once('end', ended);
        this.#response.on('readable', readable);
        readable();
      }
    });
    await this.checkpoint.assertCurrent();
  }

  async generate(request: PrivateStockSdkRequest): Promise<Buffer> {
    PrivateNativeStockSdkChannel.assertIssued(this);
    if (this.#busy || this.#requests >= 2)
      throw new PrivateNativeActionUnavailable();
    const original = this.checkpoint.pendingPlan.original;
    if (
      request.actionId !== original.actionId ||
      request.workspaceId !== original.workspaceId ||
      request.version !== 1 ||
      (this.#requests === 0
        ? request.applicationUniversalIdentifier !==
          '20202020-64aa-4b6f-b003-9c74b97cee20'
        : request.applicationId !== original.customApplicationId ||
          request.applicationUniversalIdentifier !==
            original.customApplicationId)
    )
      throw new PrivateNativeActionUnavailable();
    this.#busy = true;
    try {
      const input = Buffer.from(JSON.stringify(request));
      if (input.length > STOCK_SDK_MAX_REQUEST_BYTES)
        throw new PrivateNativeActionUnavailable();
      const header = Buffer.alloc(4);
      header.writeUInt32BE(input.length);
      await this.transfer(header, true);
      await this.transfer(input, true);
      await this.transfer(header, false);
      const length = header.readUInt32BE();
      if (!length || length > STOCK_SDK_MAX_RESULT_BYTES)
        throw new PrivateNativeActionUnavailable();
      const frame = Buffer.alloc(length);
      await this.transfer(frame, false);
      const value: unknown = JSON.parse(frame.toString('utf8'));
      if (typeof value !== 'object' || !value || Array.isArray(value))
        throw new PrivateNativeActionUnavailable();
      const result = value as Record<string, unknown>;
      if (
        Object.keys(result).sort().join(',') !== RESULT_KEYS.join(',') ||
        [
          'version',
          'actionId',
          'workspaceId',
          'applicationId',
          'applicationUniversalIdentifier',
        ].some(
          (key) => result[key] !== request[key as keyof PrivateStockSdkRequest],
        ) ||
        typeof result.archiveBase64 !== 'string' ||
        typeof result.archiveSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(result.archiveSha256) ||
        !Number.isInteger(result.archiveBytes) ||
        (result.archiveBytes as number) < 1 ||
        (result.archiveBytes as number) > STOCK_SDK_MAX_ARCHIVE_BYTES
      )
        throw new PrivateNativeActionUnavailable();
      const archive = Buffer.from(result.archiveBase64, 'base64');
      if (
        archive.toString('base64') !== result.archiveBase64 ||
        archive.length !== result.archiveBytes ||
        createHash('sha256').update(archive).digest('hex') !==
          result.archiveSha256 ||
        archive.readUInt32LE(0) !== 0x04034b50
      )
        throw new PrivateNativeActionUnavailable();
      await this.checkpoint.assertCurrent();
      this.#requests++;
      return archive;
    } catch (primary) {
      this.#terminal = true;
      throw primary;
    } finally {
      this.#busy = false;
    }
  }

  async close(): Promise<void> {
    this.#terminal = true;
    const failures: unknown[] = [];
    for (const socket of [this.#request, this.#response]) {
      try {
        await new Promise<void>((resolve, reject) => {
          if (socket.closed) return resolve();
          socket.once('close', resolve);
          socket.once('error', reject);
          socket.destroy();
        });
      } catch (error) {
        failures.push(error);
      }
    }
    failures.push(...this.#transportErrors);
    if (failures.length)
      throw new PrivateNativeStockSdkChannelFailure(failures);
  }
}

export class PrivateNativeStockSdkChannelFailure extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super('Private stock SDK channel closure requires reconciliation');
  }
}
