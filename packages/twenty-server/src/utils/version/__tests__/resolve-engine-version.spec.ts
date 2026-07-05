import {
  CURRENT_ENGINE_VERSION,
  UPGRADE_COMMAND_SUPPORTED_VERSIONS,
} from 'src/engine/constants/upgrade-command-supported-versions.constant';
import { resolveEngineVersion } from 'src/utils/version/resolve-engine-version';

describe('resolveEngineVersion', () => {
  it.each(UPGRADE_COMMAND_SUPPORTED_VERSIONS.map((version) => [version]))(
    'honors engine-track version %s as-is',
    (version) => {
      expect(resolveEngineVersion(version).version).toBe(version);
    },
  );

  it('honors an engine-track version with a patch value', () => {
    const withPatch = CURRENT_ENGINE_VERSION.replace('.0', '.7');

    expect(resolveEngineVersion(withPatch).version).toBe(withPatch);
  });

  it.each([
    ['fork release version', '0.9.52'],
    ['dockerfile default', '0.0.0'],
    ['unknown major.minor', '42.0.0'],
  ])('maps %s (%s) to the current engine version', (_label, appVersion) => {
    expect(resolveEngineVersion(appVersion).version).toBe(
      CURRENT_ENGINE_VERSION,
    );
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['invalid semver', 'not-a-version'],
  ])(
    'falls back to the current engine version when APP_VERSION is %s',
    (_label, appVersion) => {
      expect(resolveEngineVersion(appVersion).version).toBe(
        CURRENT_ENGINE_VERSION,
      );
    },
  );
});
