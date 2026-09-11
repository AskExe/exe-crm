import { type ExecutionContext } from '@nestjs/common';

import { EnterprisePlanService } from 'src/engine/core-modules/enterprise/services/enterprise-plan.service';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';

import { EnterpriseFeaturesEnabledGuard } from './enterprise-features-enabled.guard';

describe('Enterprise feature guard', () => {
  it('awaits a negative authority decision rather than treating its Promise as permission', async () => {
    const dispatchErrorFromGuard = jest.fn();
    const redirect = {
      dispatchErrorFromGuard,
      getSubdomainAndCustomDomainFromContext: () => ({}),
    } as unknown as GuardRedirectService;
    const license = {
      isValid: jest.fn().mockResolvedValue(false),
    } as unknown as EnterprisePlanService;
    const guard = new EnterpriseFeaturesEnabledGuard(redirect, license);

    expect(await guard.canActivate({} as ExecutionContext)).toBe(false);
    expect(dispatchErrorFromGuard).toHaveBeenCalledTimes(1);
  });

  it('allows a confirmed enterprise decision', async () => {
    const redirect = {} as GuardRedirectService;
    const license = {
      isValid: jest.fn().mockResolvedValue(true),
    } as unknown as EnterprisePlanService;
    const guard = new EnterpriseFeaturesEnabledGuard(redirect, license);

    expect(await guard.canActivate({} as ExecutionContext)).toBe(true);
  });
});
