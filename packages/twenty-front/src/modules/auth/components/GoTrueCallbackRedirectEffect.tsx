import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { AppPath } from 'twenty-shared/types';
import { cookieStorage } from '~/utils/cookie-storage';

const GOTRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY =
  'gotrueCallbackAttemptedAt';
const GOTRUE_CALLBACK_ATTEMPT_TTL_MS = 60_000;

const hasRecentGoTrueCallbackAttempt = () => {
  const attemptedAt = Number(
    sessionStorage.getItem(GOTRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY),
  );

  return (
    Number.isFinite(attemptedAt) &&
    Date.now() - attemptedAt < GOTRUE_CALLBACK_ATTEMPT_TTL_MS
  );
};

export const GoTrueCallbackRedirectEffect = () => {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === AppPath.Verify) {
      return;
    }

    if (getTokenPair()) {
      sessionStorage.removeItem(
        GOTRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY,
      );
      return;
    }

    const hasGoTrueSentinel = cookieStorage.getItem('exe_access_token') === '1';

    if (!hasGoTrueSentinel) {
      sessionStorage.removeItem(
        GOTRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY,
      );
      return;
    }

    if (hasRecentGoTrueCallbackAttempt()) {
      return;
    }

    // bug 74588d76: the sentinel only triggers the bridge; auth happens
    // server-side by verifying the HttpOnly exe_sess GoTrue JWT.
    sessionStorage.setItem(
      GOTRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY,
      Date.now().toString(),
    );
    window.location.assign('/api/auth/gotrue-callback');
  }, [location.pathname]);

  return <></>;
};
