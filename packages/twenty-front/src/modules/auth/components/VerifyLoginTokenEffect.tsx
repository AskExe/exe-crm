import { useEffect, useLayoutEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useHasAccessTokenPair } from '@/auth/hooks/useHasAccessTokenPair';
import { useVerifyLogin } from '@/auth/hooks/useVerifyLogin';
import { clientConfigApiStatusState } from '@/client-config/states/clientConfigApiStatusState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { AppPath } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { useNavigateApp } from '~/hooks/useNavigateApp';

export const VerifyLoginTokenEffect = () => {
  const [searchParams] = useSearchParams();
  const loginToken = searchParams.get('loginToken');
  const isDemoLogin = searchParams.get('demo') === '1';

  const hasAccessTokenPair = useHasAccessTokenPair();
  const navigate = useNavigateApp();
  const { verifyLoginToken } = useVerifyLogin();

  const { isSaved: clientConfigLoaded } = useAtomStateValue(
    clientConfigApiStatusState,
  );

  // The one-time token arrives in a redirect URL. Remove it from the address
  // bar and browser history before exchanging it, even if client config is
  // still loading or the exchange later fails. Keep the captured value only in
  // this component's memory for the exchange below.
  useLayoutEffect(() => {
    if (!isDefined(loginToken)) {
      return;
    }

    const url = new URL(window.location.href);

    if (!url.searchParams.has('loginToken')) {
      return;
    }

    url.searchParams.delete('loginToken');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [loginToken]);

  useEffect(() => {
    if (!clientConfigLoaded) {
      return;
    }

    if (isDefined(loginToken)) {
      verifyLoginToken(loginToken, isDemoLogin);
    } else if (!hasAccessTokenPair) {
      navigate(AppPath.SignInUp);
    }
    // Verify only needs to run once at mount
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [clientConfigLoaded]);

  return <></>;
};
