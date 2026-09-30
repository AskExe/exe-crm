import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderHook } from '@testing-library/react';

import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';
import { useAuth } from '@/auth/hooks/useAuth';
import { useVerifyLogin } from '@/auth/hooks/useVerifyLogin';
import { getDemoWorkspaceId } from '@/auth/utils/goTrueBridge';
import { replaceWorkspaceDocument } from '@/auth/utils/replaceWorkspaceDocument';

jest.mock('@/auth/utils/replaceWorkspaceDocument', () => ({
  replaceWorkspaceDocument: jest.fn(),
}));

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
    expect(replaceWorkspaceDocument).toHaveBeenCalledTimes(1);
  });

  it('clears the previous workspace view and DEMO routing hint on an Exe exchange', async () => {
    mockGetAuthTokensFromLoginToken.mockResolvedValueOnce('demo-workspace');
    const { result } = renderHooks();
    await result.current.verifyLoginToken('demo-token', true);
    localStorage.setItem(
      'lastVisitedViewPerObjectMetadataItemState',
      'old-demo-view',
    );
    mockGetAuthTokensFromLoginToken.mockResolvedValueOnce('exe-workspace');
    await result.current.verifyLoginToken('exe-token');
    expect(getDemoWorkspaceId()).toBeNull();
    expect(
      localStorage.getItem('lastVisitedViewPerObjectMetadataItemState'),
    ).toBeNull();
    expect(replaceWorkspaceDocument).toHaveBeenCalledTimes(2);
  });

  it('does not reload or mark DEMO while MFA has not completed', async () => {
    mockGetAuthTokensFromLoginToken.mockResolvedValueOnce(undefined);
    const { result } = renderHooks();
    await result.current.verifyLoginToken('mfa-token', true);
    expect(getDemoWorkspaceId()).toBeNull();
    expect(replaceWorkspaceDocument).not.toHaveBeenCalled();
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
    expect(replaceWorkspaceDocument).not.toHaveBeenCalled();
  });
});
