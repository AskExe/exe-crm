import {
  clearGoTrueCallbackAttempt,
  GO_TRUE_BRIDGE_IN_FLIGHT_MS,
  GO_TRUE_CALLBACK_ATTEMPT_TTL_MS,
  GO_TRUE_SENTINEL_COOKIE_NAME,
  GO_TRUE_SENTINEL_COOKIE_VALUE,
  hasGoTrueSentinelCookie,
  hasRecentGoTrueCallbackAttempt,
  isGoTrueBridgeInFlight,
  markGoTrueCallbackAttempt,
  readGoTrueCallbackAttemptedAt,
  resetGoTrueBridgeFailureCaptureForTesting,
} from '@/auth/utils/goTrueBridge';

const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}`;
};

const clearCookies = () => {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();

    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
};

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/${search}`);
  resetGoTrueBridgeFailureCaptureForTesting();
};

const NOW = 1_700_000_000_000;

const giveApexSessionWithoutCrmSession = () => {
  setCookie(GO_TRUE_SENTINEL_COOKIE_NAME, GO_TRUE_SENTINEL_COOKIE_VALUE);
};

const giveCrmSession = () => {
  setCookie(
    'tokenPair',
    encodeURIComponent(
      JSON.stringify({
        accessOrWorkspaceAgnosticToken: { token: 'a', expiresAt: 'later' },
        refreshToken: { token: 'r', expiresAt: 'later' },
      }),
    ),
  );
};

describe('goTrueBridge', () => {
  beforeEach(() => {
    clearCookies();
    sessionStorage.clear();
    setSearch('');
  });

  it('reads the apex sentinel only when it carries the agreed value', () => {
    expect(hasGoTrueSentinelCookie()).toBe(false);

    setCookie(GO_TRUE_SENTINEL_COOKIE_NAME, 'something-else');
    expect(hasGoTrueSentinelCookie()).toBe(false);

    setCookie(GO_TRUE_SENTINEL_COOKIE_NAME, GO_TRUE_SENTINEL_COOKIE_VALUE);
    expect(hasGoTrueSentinelCookie()).toBe(true);
  });

  it('records and clears an attempt timestamp', () => {
    expect(readGoTrueCallbackAttemptedAt()).toBeNull();

    markGoTrueCallbackAttempt(NOW);
    expect(readGoTrueCallbackAttemptedAt()).toBe(NOW);

    clearGoTrueCallbackAttempt();
    expect(readGoTrueCallbackAttemptedAt()).toBeNull();
  });

  it('treats a garbage attempt timestamp as no attempt', () => {
    sessionStorage.setItem('gotrueCallbackAttemptedAt', 'not-a-number');

    expect(readGoTrueCallbackAttemptedAt()).toBeNull();
    expect(hasRecentGoTrueCallbackAttempt(NOW)).toBe(false);
  });

  it('suppresses a retry for the whole livelock TTL and no longer', () => {
    markGoTrueCallbackAttempt(NOW);

    expect(
      hasRecentGoTrueCallbackAttempt(NOW + GO_TRUE_CALLBACK_ATTEMPT_TTL_MS - 1),
    ).toBe(true);
    expect(
      hasRecentGoTrueCallbackAttempt(NOW + GO_TRUE_CALLBACK_ATTEMPT_TTL_MS),
    ).toBe(false);
  });

  describe('isGoTrueBridgeInFlight', () => {
    it('is false for a visitor with no apex session', () => {
      expect(isGoTrueBridgeInFlight(NOW)).toBe(false);
    });

    // The regression. An apex session exists, the exchange has not produced a
    // CRM token pair yet, and the app must NOT read that absence as "logged
    // out" — that is what bounced a succeeding login back to a login form.
    it('is true when an apex session is present and the exchange has not run yet', () => {
      giveApexSessionWithoutCrmSession();

      expect(isGoTrueBridgeInFlight(NOW)).toBe(true);
    });

    it('stays true while a slow exchange is still within the in-flight window', () => {
      giveApexSessionWithoutCrmSession();
      markGoTrueCallbackAttempt(NOW);

      expect(
        isGoTrueBridgeInFlight(NOW + GO_TRUE_BRIDGE_IN_FLIGHT_MS - 1),
      ).toBe(true);
    });

    // Bounded, so a wedged bridge degrades to a usable login form rather than
    // an eternal spinner — the livelock of bug 83ba9546 in a new costume.
    it('gives up once the in-flight window expires', () => {
      giveApexSessionWithoutCrmSession();
      markGoTrueCallbackAttempt(NOW);

      expect(isGoTrueBridgeInFlight(NOW + GO_TRUE_BRIDGE_IN_FLIGHT_MS)).toBe(
        false,
      );
    });

    it('is false once the exchange has produced a CRM session', () => {
      giveApexSessionWithoutCrmSession();
      giveCrmSession();

      expect(isGoTrueBridgeInFlight(NOW)).toBe(false);
    });

    it('is false immediately when the bridge redirected back with a reason', () => {
      giveApexSessionWithoutCrmSession();
      setSearch('?ssoError=no_crm_access');

      expect(isGoTrueBridgeInFlight(NOW)).toBe(false);
    });

    it('keeps that verdict after the reason has been stripped from the URL', () => {
      giveApexSessionWithoutCrmSession();
      setSearch('?ssoError=token_unverifiable');
      expect(isGoTrueBridgeInFlight(NOW)).toBe(false);

      // react-router removes the query string on the next navigation; the
      // server's answer is still in.
      window.history.replaceState({}, '', '/sign-in-up');

      expect(isGoTrueBridgeInFlight(NOW)).toBe(false);
    });
  });
});
