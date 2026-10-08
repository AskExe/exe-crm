import { DataSource } from 'typeorm';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';

// Deliberately uncallable admission boundary. Helper identity alone cannot issue
// a structural capability. The reviewed full catalog must include actual PG16
// policy rendering and original-role compatibility before this can be replaced.
// No caller can supply a boolean, descriptor, expected body or authority callback.
export class PrivateNativeStructuralDatabaseGuard {
  constructor(database: DataSource) {
    if (!(database instanceof DataSource) || !database.isInitialized)
      throw new PrivateNativeActionUnavailable();
  }

  assertCurrent(): Promise<void> {
    return Promise.reject(new PrivateNativeActionUnavailable());
  }
}
