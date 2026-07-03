import { Injectable, Logger } from '@nestjs/common';

import { SemVer } from 'semver';
import { isDefined } from 'twenty-shared/utils';

import { UPGRADE_COMMAND_SUPPORTED_VERSIONS } from 'src/engine/constants/upgrade-command-supported-versions.constant';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { getPreviousVersion } from 'src/utils/version/get-previous-version';
import { resolveEngineVersion } from 'src/utils/version/resolve-engine-version';

@Injectable()
export class CoreEngineVersionService {
  private readonly logger = new Logger(CoreEngineVersionService.name);
  private hasLoggedEngineVersionMapping = false;

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  getCurrentVersion(): SemVer {
    const appVersion = this.twentyConfigService.get('APP_VERSION');
    const engineVersion = resolveEngineVersion(appVersion);

    // APP_VERSION carries the exe-crm release (e.g. 0.9.52) or is unset;
    // migrations run on the engine track (bug 928a4140). Log the mapping once.
    if (
      appVersion !== engineVersion.version &&
      !this.hasLoggedEngineVersionMapping
    ) {
      this.hasLoggedEngineVersionMapping = true;
      this.logger.log(
        `APP_VERSION="${appVersion ?? 'unset'}" is not on the migration engine track — using engine version ${engineVersion.version} for workspace migrations`,
      );
    }

    return engineVersion;
  }

  getPreviousVersion(): SemVer {
    const currentAppVersion = this.getCurrentVersion();
    const currentVersionMajorMinor = `${currentAppVersion.major}.${currentAppVersion.minor}.0`;

    const previousVersion = getPreviousVersion({
      currentVersion: currentVersionMajorMinor,
      versions: [...UPGRADE_COMMAND_SUPPORTED_VERSIONS],
    });

    if (!isDefined(previousVersion)) {
      throw new Error(
        `No previous version found for version ${currentAppVersion}. Available versions: ${UPGRADE_COMMAND_SUPPORTED_VERSIONS.join(', ')}`,
      );
    }

    return previousVersion;
  }
}
