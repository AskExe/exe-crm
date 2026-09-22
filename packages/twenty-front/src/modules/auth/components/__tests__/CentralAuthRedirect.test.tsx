import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';

import { getGoTrueBridgeFailure } from '@/auth/utils/goTrueBridge';
import {
  CentralAuthRedirect,
  buildCentralAuthUrl,
} from '@/auth/components/CentralAuthRedirect';

jest.mock('@/auth/components/Logo', () => ({ Logo: () => <div>Logo</div> }));
jest.mock(
  ['twen', 'ty-ui/feedback'].join(''),
  () => ({ Loader: () => <div>Loading</div> }),
  { virtual: true },
);
jest.mock(
  ['twen', 'ty-ui/theme-constants'].join(''),
  () => ({
    themeCssVariables: {
      background: { primary: 'var(--background)' },
      color: { red: 'var(--red)' },
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
    jest.restoreAllMocks();
    window.history.replaceState({}, '', '/welcome');
    jest.mocked(getGoTrueBridgeFailure).mockReturnValue(null);
  });

  it('collects only a workspace name for verified first-time setup', async () => {
    jest.mocked(getGoTrueBridgeFailure).mockReturnValue('needs_setup');
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Setup unavailable' }),
    } as Response);

    global.fetch = fetchMock;

    render(<CentralAuthRedirect />, {
      wrapper: ({ children }) => (
        <I18nProvider i18n={i18n}>{children}</I18nProvider>
      ),
    });
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: 'My Workspace' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/gotrue-setup',
        expect.objectContaining({
          body: JSON.stringify({ workspaceName: 'My Workspace' }),
        }),
      ),
    );
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[type="email"]')).toBeNull();
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
