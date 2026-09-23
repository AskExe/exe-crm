import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderHook } from '@testing-library/react';

import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';
import { useAuth } from '@/auth/hooks/useAuth';
import { useVerifyLogin } from '@/auth/hooks/useVerifyLogin';
import { getDemoWorkspaceId } from '@/auth/utils/goTrueBridge';

import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

jest.mock('../useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: jest.fn(),
}));

jest.mock('~/hooks/useNavigateApp', () => ({
  useNavigateApp: jest.fn(),
}));

dynamicActivate(SOURCE_LOCALE);

const renderHooks = () => {
  const { result } = renderHook(() => useVerifyLogin(), {
    wrapper: ({ children }) => I18nProvider({ i18n, children }),
  });
  return { result };
};

describe('useVerifyLogin', () => {
  const mockGetAuthTokensFromLoginToken = jest.fn();
  const mockEnqueueErrorSnackBar = jest.fn();
  const mockNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();

    (useAuth as jest.Mock).mockReturnValue({
      getAuthTokensFromLoginToken: mockGetAuthTokensFromLoginToken,
    });

    (useSnackBar as jest.Mock).mockReturnValue({
      enqueueErrorSnackBar: mockEnqueueErrorSnackBar,
    });

    (useNavigateApp as jest.Mock).mockReturnValue(mockNavigate);
  });

  it('should verify login token', async () => {
    const { result } = renderHooks();

    await result.current.verifyLoginToken('test-token');

    expect(mockGetAuthTokensFromLoginToken).toHaveBeenCalledWith('test-token');
  });

  it('marks the actual workspace on the destination origin after DEMO token exchange', async () => {
    mockGetAuthTokensFromLoginToken.mockResolvedValueOnce('demo-workspace');
    const { result } = renderHooks();

    await result.current.verifyLoginToken('test-token', true);

    expect(getDemoWorkspaceId()).toBe('demo-workspace');
  });

  it('should handle verification error', async () => {
    const error = new Error('Verification failed');
    mockGetAuthTokensFromLoginToken.mockRejectedValueOnce(error);

    const { result } = renderHooks();

    await result.current.verifyLoginToken('test-token');

    expect(mockEnqueueErrorSnackBar).toHaveBeenCalledWith({
      message: 'Authentication failed',
    });
    expect(mockNavigate).toHaveBeenCalledWith(AppPath.SignInUp);
  });
});
