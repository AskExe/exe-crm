/**
 * Type shims for ESM-only packages that tsc cannot resolve under
 * moduleResolution:node (commonjs). The runtime SWC build handles these
 * correctly. These shims let tsc pass typecheck without altering the
 * global moduleResolution setting.
 *
 * If file-type ships a CJS-compatible entry point in the future, these shims
 * can be removed and the imports will resolve naturally.
 */

declare module 'file-type' {
  export type FileTypeResult = {
    readonly ext: string;
    readonly mime: string;
  };

  export type Detector = {
    id: string;
    detect: (
      tokenizer: unknown,
      fileType?: FileTypeResult,
    ) => Promise<FileTypeResult | undefined>;
  };

  export type FileTypeOptions = {
    customDetectors?: Iterable<Detector>;
    signal?: AbortSignal;
  };

  export class FileTypeParser {
    detectors: Detector[];
    constructor(options?: FileTypeOptions);
    fromBuffer(
      buffer: Uint8Array | ArrayBuffer,
    ): Promise<FileTypeResult | undefined>;
    fromTokenizer(tokenizer: unknown): Promise<FileTypeResult | undefined>;
    fromBlob(blob: Blob): Promise<FileTypeResult | undefined>;
    fromStream(
      stream: ReadableStream<Uint8Array>,
    ): Promise<FileTypeResult | undefined>;
    fromFile(filePath: string): Promise<FileTypeResult | undefined>;
  }

  export const supportedMimeTypes: ReadonlySet<string>;

  export function fileTypeFromBuffer(
    buffer: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;

  export function fileTypeFromStream(
    stream: ReadableStream<Uint8Array>,
  ): Promise<FileTypeResult | undefined>;
}

declare module '@file-type/pdf' {
  import type { Detector } from 'file-type';
  export const detectPdf: Detector;
}
