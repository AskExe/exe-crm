import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

export const isNativePasswordAuthDisabled = (
  twentyConfigService: TwentyConfigService,
) => Boolean(twentyConfigService.get('GOTRUE_URL'));
