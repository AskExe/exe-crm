import {
  type ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common';

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

  it('preserves retryable authority errors instead of redirecting SSO requests', async () => {
    const dispatchErrorFromGuard = jest.fn();
    const guard = new EnterpriseFeaturesEnabledGuard(
      { dispatchErrorFromGuard } as unknown as GuardRedirectService,
      {
        isValid: jest.fn().mockRejectedValue(new ServiceUnavailableException()),
      } as unknown as EnterprisePlanService,
    );
    await expect(
      guard.canActivate({} as ExecutionContext),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(dispatchErrorFromGuard).not.toHaveBeenCalled();
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
