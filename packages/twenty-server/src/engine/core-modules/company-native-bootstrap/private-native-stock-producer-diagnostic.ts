import { writeSync } from 'node:fs';

import { CircularDependencyException } from '@nestjs/core/errors/exceptions/circular-dependency.exception';
import { UnknownDependenciesException } from '@nestjs/core/errors/exceptions/unknown-dependencies.exception';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

const contextOperations = [
  'issued-checkpoint',
  'issued-custody',
  'issued-storage',
  'issued-channel',
  'binding-custody',
  'binding-storage',
  'binding-channel',
  'authority',
  'connection',
  'cache',
  'checkpoint',
  'providers',
  'create-and-initialize',
  'final-checkpoint',
] as const;
const contextCategories = [
  'unavailable',
  'dependency',
  'cycle',
  'type',
  'error',
  'other',
] as const;

export type PrivateStockContextOperation = (typeof contextOperations)[number];

const producerStages = new Set([
  ...contextOperations.flatMap((operation) =>
    contextCategories.map(
      (category) => `stock-context-${operation}-${category}`,
    ),
  ),
  'input-admission',
  'issued-frame',
  'operator-trust',
  'operator-profile',
  'storage-secrets',
  'database-connect',
  'authority-check',
  'pending-allocation',
  'pending-observation',
  'stock-imports',
  'stock-fence',
  'stock-checkpoint',
  'stock-session',
  'stock-prepare',
  'stock-prepare-current',
  'stock-prepare-control',
  'stock-prepare-begin',
  'stock-prepare-business',
  'stock-prepare-identity',
  'stock-prepare-custody',
  'stock-prepare-storage',
  'stock-storage-issued',
  'stock-storage-runtime',
  'stock-storage-ancestor-root',
  'stock-storage-ancestor-app',
  'stock-storage-ancestor-local',
  'stock-storage-current-issued',
  'stock-storage-current-deadline',
  'stock-storage-current-old-role',
  'stock-storage-current-core-authority',
  'stock-storage-current-owner-lease',
  'stock-storage-endpoint',
  'stock-storage-metadata',
  'stock-storage-directory-workspace',
  'stock-storage-directory-custom',
  'stock-storage-directory-dependencies',
  'stock-storage-directory-current',
  'stock-storage-entries',
  'stock-storage-file-package',
  'stock-storage-file-lock',
  'stock-storage-file-close',
  'stock-prepare-channel',
  'stock-prepare-context',
  'stock-prepare-activate',
  'stock-prepare-complete',
  'stock-prepare-final-current',
  'stock-prepare-output-bind',
  'stock-prepare-observe',
  'stock-prepare-output-observe',
  'stock-final-check',
]);

// Owned fixed stages only; report before cleanup can close the snapshot pipe.
export class PrivateNativeStockProducerDiagnostic {
  stage = 'input-admission';
  #reported = false;

  reportFailure(): void {
    if (this.#reported || !producerStages.has(this.stage)) return;
    this.#reported = true;
    try {
      writeSync(
        2,
        JSON.stringify({
          kind: 'crm-stock-producer-failure-v1',
          producerStage: this.stage,
        }) + '\n',
      );
    } catch {
      // Failed diagnostic writes never change refusal or retry during cleanup.
    }
  }
}

// Diagnostic callbacks cannot interrupt refusal or independent owner cleanup.
export function reportPrivateStockProducerFailure(diagnostic?: {
  reportFailure?: () => void;
}): void {
  try {
    diagnostic?.reportFailure?.();
  } catch {
    // Reporting is best-effort even for a throwing optional callback.
  }
}

// Exact trusted prototypes only; no message, constructor/name/stack getters or
// caller-defined exception names enter the diagnostic channel.
const contextExceptions = new Map<object, string>([
  [PrivateNativeActionUnavailable.prototype, 'unavailable'],
  [UnknownDependenciesException.prototype, 'dependency'],
  [CircularDependencyException.prototype, 'cycle'],
  [TypeError.prototype, 'type'],
  [Error.prototype, 'error'],
]);

export function reportPrivateStockContextFailure(
  diagnostic: { stage: string; reportFailure?: () => void } | undefined,
  operation: PrivateStockContextOperation,
  primary: unknown,
): void {
  try {
    if (!diagnostic || !contextOperations.includes(operation)) return;
    let category = 'other';
    try {
      if (primary !== null && typeof primary === 'object')
        category =
          contextExceptions.get(Object.getPrototypeOf(primary)) ?? 'other';
    } catch {
      // Uninspectable exceptions still retain the operation that failed.
    }
    diagnostic.stage = `stock-context-${operation}-${category}`;
    reportPrivateStockProducerFailure(diagnostic);
  } catch {
    // Even a hostile diagnostic/proxy cannot replace the original exception.
  }
}
