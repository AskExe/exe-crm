import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { getTokenPair } from '@/apollo/utils/getTokenPair';
import {
  clearGoTrueCallbackAttempt,
  GO_TRUE_CALLBACK_PATH,
  hasGoTrueSentinelCookie,
  hasRecentGoTrueCallbackAttempt,
  markGoTrueCallbackAttempt,
} from '@/auth/utils/goTrueBridge';
import { AppPath } from 'twenty-shared/types';

export const GoTrueCallbackRedirectEffect = () => {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === AppPath.Verify) {
      return;
    }

    if (getTokenPair()) {
      clearGoTrueCallbackAttempt();
      return;
    }

    if (!hasGoTrueSentinelCookie()) {
      clearGoTrueCallbackAttempt();
      return;
    }

    if (hasRecentGoTrueCallbackAttempt()) {
      return;
    }

    // SSO bridge contract — the companion exe-os PR sets these two cookies on
    // the shared apex domain after login at auth.<domain>:
    //   exe_access_token=1  non-HttpOnly sentinel (readable by JS here) that
    //                       only TRIGGERS the bridge; it never authenticates.
    //   exe_sess=<GoTrue JWT>  HttpOnly; carries the real access_token, read
    //                          ONLY server-side by GET /api/auth/gotrue-callback,
    //                          which verifies it and mints a CRM loginToken.
    // The names/values live in `@/auth/utils/goTrueBridge` and MUST match what
    // auth.<domain> sets.
    //
    // Mark BEFORE navigating, not after: `assign` only schedules a navigation,
    // and the rest of the app renders — and decides where it belongs — during
    // the seconds before the browser leaves. Marking first is what lets
    // `isGoTrueBridgeInFlight` tell "not logged in" apart from "not logged in
    // YET" while that navigation is in the air (bug 88f4f6f3).
    markGoTrueCallbackAttempt();
    window.location.assign(GO_TRUE_CALLBACK_PATH);
  }, [location.pathname]);

  return <></>;
};
