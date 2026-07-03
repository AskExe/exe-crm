export const UPGRADE_COMMAND_SUPPORTED_VERSIONS = ['1.19.0', '1.20.0'] as const;

export type UpgradeCommandVersion =
  (typeof UPGRADE_COMMAND_SUPPORTED_VERSIONS)[number];

/**
 * The engine version the fork's workspace-migration commands currently
 * target. exe-crm ships releases on its own 0.9.x track (APP_VERSION), while
 * the inherited Twenty migration engine is keyed to these upstream engine
 * versions. Bump this when a new UPGRADE_COMMAND_SUPPORTED_VERSIONS entry is
 * added (bug 928a4140).
 */
export const CURRENT_ENGINE_VERSION: UpgradeCommandVersion =
  UPGRADE_COMMAND_SUPPORTED_VERSIONS[
    UPGRADE_COMMAND_SUPPORTED_VERSIONS.length - 1
  ];
