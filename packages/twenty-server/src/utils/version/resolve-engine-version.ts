import { SemVer } from 'semver';

import {
  CURRENT_ENGINE_VERSION,
  UPGRADE_COMMAND_SUPPORTED_VERSIONS,
} from 'src/engine/constants/upgrade-command-supported-versions.constant';

/**
 * Resolves the Twenty engine version that drives workspace migrations.
 *
 * exe-crm ships releases on its own 0.9.x track (APP_VERSION is set to the
 * fork release, e.g. 0.9.52, by the customer stack), while the inherited
 * workspace-migration engine is keyed to upstream engine versions
 * (UPGRADE_COMMAND_SUPPORTED_VERSIONS). An APP_VERSION already on the engine
 * track is honored as-is; anything else — fork release versions, the
 * Dockerfile default 0.0.0, unset, or invalid semver — resolves to
 * CURRENT_ENGINE_VERSION so startup migrations never crash on the fork
 * version (bug 928a4140).
 */
export const resolveEngineVersion = (
  appVersion: string | undefined | null,
): SemVer => {
  if (appVersion) {
    try {
      const parsed = new SemVer(appVersion);
      const majorMinor = `${parsed.major}.${parsed.minor}.0`;

      if (
        (UPGRADE_COMMAND_SUPPORTED_VERSIONS as readonly string[]).includes(
          majorMinor,
        )
      ) {
        return parsed;
      }
    } catch {
      // Not a valid semver — fall through to the engine version.
    }
  }

  return new SemVer(CURRENT_ENGINE_VERSION);
};
