import { ConfigService } from '@nestjs/config';

import { PrivateNativeActionUnavailable } from 'src/engine/core-modules/company-native-bootstrap/private-native-action-reader';
import { ConfigVariables } from 'src/engine/core-modules/twenty-config/config-variables';
import { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';

// No ambient process configuration or database config driver enters the private
// stock graph. Native defaults and this fixed isolated connection are sufficient.
export class PrivateNativeStockEnvironment extends EnvironmentConfigDriver {
  readonly #values: Readonly<ConfigVariables>;
  constructor(databaseUrl: string) {
    const url = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.username !== 'exe_crm_native_stock_provisioner' ||
      !url.password ||
      url.search ||
      url.hash
    )
      throw new PrivateNativeActionUnavailable();
    const values = Object.assign(new ConfigVariables(), {
      PG_DATABASE_URL: databaseUrl,
      PG_POOL_MAX_CONNECTIONS: 1,
      PG_DATABASE_PRIMARY_TIMEOUT_MS: 5000,
      IS_CONFIG_VARIABLES_IN_DB_ENABLED: false,
      IS_BILLING_ENABLED: false,
      STORAGE_LOCAL_PATH: '/app/.local-storage',
      TELEMETRY_ENABLED: false,
    });
    super(new ConfigService(), values);
    this.#values = Object.freeze(values);
  }

  override get<Key extends keyof ConfigVariables>(
    key: Key,
  ): ConfigVariables[Key] {
    return this.#values[key];
  }
}
