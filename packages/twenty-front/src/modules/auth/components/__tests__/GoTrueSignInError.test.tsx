import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';

import { GoTrueSignInError } from '@/auth/components/GoTrueSignInError';
import { getGoTrueBridgeFailure } from '@/auth/utils/goTrueBridge';

jest.mock('@/auth/utils/goTrueBridge', () => ({
  getGoTrueBridgeFailure: jest.fn(),
}));

const renderNotice = (reason: string | null) => {
  jest.mocked(getGoTrueBridgeFailure).mockReturnValue(reason);

  return render(
    <I18nProvider i18n={i18n}>
      <GoTrueSignInError />
    </I18nProvider>,
  );
};

it('explains workspace setup failure with a persistent accessible notice', () => {
  renderNotice('not_provisioned');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Your CRM workspace access is not ready.',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Signing in again will not complete workspace setup.',
  );
});

it('distinguishes missing access from an expired session', () => {
  const notice = renderNotice('no_crm_access');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Ask your administrator for a CRM invitation or access.',
  );
  notice.unmount();
  renderNotice('session_expired');
  expect(screen.getByRole('alert')).toHaveTextContent('Sign in again');
});

it('does not display arbitrary query contents or account details', () => {
  renderNotice('<img src=x onerror=alert(1)>private@example.com');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'CRM could not complete sign-in.',
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'private@example.com',
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('does not show an error on normal sign-in', () => {
  renderNotice(null);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
