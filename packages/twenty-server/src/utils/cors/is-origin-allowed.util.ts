import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { NodeEnvironment } from 'src/engine/core-modules/twenty-config/interfaces/node-environment.interface';
import { type WorkspaceDomainsService } from 'src/engine/core-modules/domain/workspace-domains/services/workspace-domains.service';

const LOCAL_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

const normalizeOrigin = (value: string) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const getConfiguredOrigins = (twentyConfigService: TwentyConfigService) =>
  new Set(
    [
      twentyConfigService.get('FRONTEND_URL'),
      twentyConfigService.get('SERVER_URL'),
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => normalizeOrigin(value))
      .filter((value): value is string => value !== null),
  );

export const isOriginAllowed = async ({
  origin,
  twentyConfigService,
  workspaceDomainsService,
}: {
  origin: string | undefined;
  twentyConfigService: TwentyConfigService;
  workspaceDomainsService: WorkspaceDomainsService;
}) => {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedOrigin) {
    return false;
  }

  if (LOCAL_ORIGIN_REGEX.test(normalizedOrigin)) {
    return twentyConfigService.get('NODE_ENV') === NodeEnvironment.DEVELOPMENT;
  }

  if (getConfiguredOrigins(twentyConfigService).has(normalizedOrigin)) {
    return true;
  }

  if (!twentyConfigService.get('IS_MULTIWORKSPACE_ENABLED')) {
    return false;
  }

  const workspace =
    await workspaceDomainsService.getWorkspaceByOriginOrDefaultWorkspace(
      normalizedOrigin,
    );

  return Boolean(workspace);
};
