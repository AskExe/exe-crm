import { render, screen } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';

import { getGoTrueBridgeFailure } from '@/auth/utils/goTrueBridge';
import {
  CentralAuthRedirect,
  buildCentralAuthUrl,
} from '@/auth/components/CentralAuthRedirect';

jest.mock('@/auth/components/Logo', () => ({ Logo: () => <div>Logo</div> }));
jest.mock('twenty-ui/feedback', () => ({ Loader: () => <div>Loading</div> }), {
  virtual: true,
});
jest.mock(
  'twenty-ui/theme-constants',
  () => ({
    themeCssVariables: {
      background: { primary: 'var(--background)' },
      border: {
        color: { medium: 'var(--border)' },
        radius: { md: '8px' },
      },
      font: {
        color: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
      },
    },
  }),
  { virtual: true },
);
jest.mock('@/auth/utils/goTrueBridge', () => ({
  getGoTrueBridgeFailure: jest.fn(),
}));

describe('CentralAuthRedirect', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/welcome');
    jest.mocked(getGoTrueBridgeFailure).mockReturnValue(null);
  });

  it('builds a central URL with only the server callback', () => {
    const url = new URL(buildCentralAuthUrl());
    expect(url.hostname).toMatch(/^auth\./);
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('product')).toBe('CRM');
    expect(url.searchParams.get('redirect')).toBe(
      `${window.location.origin}/api/auth/gotrue-callback`,
    );
    expect(url.search).not.toContain('passwordResetToken');
  });

  it('shows retry without a credential form after a bridge failure', () => {
    jest.mocked(getGoTrueBridgeFailure).mockReturnValue('server_error');
    render(<CentralAuthRedirect />, {
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      ),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try sign-in again/i }),
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });
});
