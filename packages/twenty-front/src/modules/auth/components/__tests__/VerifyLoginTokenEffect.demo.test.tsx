import { useNavigateApp } from '~/hooks/useNavigateApp';
let mockCompanyEditorEnabled = false;
jest.mock('~/config', () => ({
  ...jest.requireActual('~/config'),
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockCompanyEditorEnabled;
  },
}));
import { render, waitFor } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';

import { VerifyLoginTokenEffect } from '@/auth/components/VerifyLoginTokenEffect';
import { useHasAccessTokenPair } from '@/auth/hooks/useHasAccessTokenPair';
import { useVerifyLogin } from '@/auth/hooks/useVerifyLogin';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: jest.fn(),
}));
jest.mock('@/auth/hooks/useHasAccessTokenPair');
jest.mock('@/auth/hooks/useVerifyLogin');
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue');
jest.mock('~/hooks/useNavigateApp', () => ({ useNavigateApp: jest.fn() }));

it('passes the server-marked DEMO token exchange to the destination-origin verifier', async () => {
  window.history.replaceState(
    {},
    '',
    '/verify?loginToken=one-time-token&demo=1',
  );
  const verifyLoginToken = jest.fn(async () => {
    expect(window.location.search).toBe('?demo=1');
  });
  jest
    .mocked(useSearchParams)
    .mockReturnValue([
      new URLSearchParams('loginToken=one-time-token&demo=1'),
      jest.fn(),
    ]);
  jest.mocked(useHasAccessTokenPair).mockReturnValue(false);
  jest.mocked(useVerifyLogin).mockReturnValue({ verifyLoginToken });
  jest.mocked(useAtomStateValue).mockReturnValue({ isSaved: true });

  render(<VerifyLoginTokenEffect />);

  await waitFor(() =>
    expect(verifyLoginToken).toHaveBeenCalledWith('one-time-token', true),
  );
  expect(window.location.search).toBe('?demo=1');
});

it.each([false, true])(
  'hosted editor never exchanges native loginToken or redirects to legacy sign-in (ready=%s)',
  (ready) => {
    mockCompanyEditorEnabled = true;
    const verifyLoginToken = jest.fn();
    const navigate = jest.fn();
    jest
      .mocked(useSearchParams)
      .mockReturnValue([
        new URLSearchParams('loginToken=foreign-native-token'),
        jest.fn(),
      ]);
    jest.mocked(useHasAccessTokenPair).mockReturnValue(ready);
    jest.mocked(useVerifyLogin).mockReturnValue({ verifyLoginToken });
    jest.mocked(useAtomStateValue).mockReturnValue({ isSaved: true });
    jest.mocked(useNavigateApp).mockReturnValue(navigate);
    try {
      render(<VerifyLoginTokenEffect />);
      expect(verifyLoginToken).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      mockCompanyEditorEnabled = false;
    }
  },
);
