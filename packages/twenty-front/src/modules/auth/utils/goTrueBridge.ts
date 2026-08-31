import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { isDefined } from 'twenty-shared/utils';
import { cookieStorage } from '~/utils/cookie-storage';

/**
 * Shared state of the Exe SSO bridge — the hand-off that turns an apex GoTrue
 * session into a CRM one.
 *
 * WHY THIS IS ITS OWN MODULE (bug 88f4f6f3). The knowledge that a bridge is
 * mid-flight used to live entirely inside `GoTrueCallbackRedirectEffect`, as
 * one private sessionStorage key. Nothing else in the app could see it — so
 * `usePageChangeEffectNavigateLocation`, running in the same render pass, read
 * "no CRM token pair" and concluded "not logged in", and sent the browser to
 * the sign-in form while the exchange that was about to produce that very
 * token pair was still in the air. The user watched an app they had already
 * successfully authenticated into regress to a login screen.
 *
 * Two components deciding the same question from different evidence is the
 * bug. There is one definition of "in flight" here, and both use it.
 */

/**
 * Non-HttpOnly sentinel set by auth.<domain> on the shared apex domain. It
 * only ever TRIGGERS the bridge; it never authenticates anything. The real
 * credential travels in the HttpOnly `exe_sess` cookie, which only
 * `GET /api/auth/gotrue-callback` reads, server-side.
 *
 * The name and value MUST match what auth.<domain> sets.
 */
export const GO_TRUE_SENTINEL_COOKIE_NAME = 'exe_access_token';
export const GO_TRUE_SENTINEL_COOKIE_VALUE = '1';

export const GO_TRUE_CALLBACK_PATH = '/api/auth/gotrue-callback';

const GO_TRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY =
  'gotrueCallbackAttemptedAt';

/**
 * Livelock guard (bug 83ba9546): how long a failed bridge attempt suppresses
 * the next one. Long, because the failure mode it prevents — bounce, retry,
 * bounce — burns a browser tab.
 */
export const GO_TRUE_CALLBACK_ATTEMPT_TTL_MS = 60_000;

/**
 * How long after triggering the bridge the app still believes the browser is
 * on its way to it, and so withholds the sign-in form.
 *
 * Deliberately far shorter than the retry TTL above, and deliberately BOUNDED:
 * a bridge that never navigates must degrade to a login form the user can
 * actually use. An unbounded "wait for the exchange" is just the livelock
 * again wearing a spinner.
 */
export const GO_TRUE_BRIDGE_IN_FLIGHT_MS = 10_000;

/**
 * Did the document we are running in arrive here as the bridge's own failure
 * redirect? Captured once, lazily, because `?ssoError=` only ever appears on
 * that document and react-router strips it from the URL as soon as the user
 * navigates — by which time the answer still matters.
 *
 * A reported failure ends the in-flight state immediately: the server has
 * already told us it gave up, so making the user wait out a timeout before
 * showing them a login form would be withholding a decision that is in.
 */
let bridgeReportedFailureOnLoad: boolean | undefined;

const hasBridgeReportedFailure = (): boolean => {
  if (bridgeReportedFailureOnLoad === undefined) {
    bridgeReportedFailureOnLoad = new URLSearchParams(
      window.location.search,
    ).has('ssoError');
  }

  return bridgeReportedFailureOnLoad;
};

export const hasGoTrueSentinelCookie = (): boolean =>
  cookieStorage.getItem(GO_TRUE_SENTINEL_COOKIE_NAME) ===
  GO_TRUE_SENTINEL_COOKIE_VALUE;

export const readGoTrueCallbackAttemptedAt = (): number | null => {
  const raw = sessionStorage.getItem(
    GO_TRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY,
  );

  if (raw === null) {
    return null;
  }

  const attemptedAt = Number(raw);

  return Number.isFinite(attemptedAt) ? attemptedAt : null;
};

export const markGoTrueCallbackAttempt = (now: number = Date.now()): void => {
  sessionStorage.setItem(
    GO_TRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY,
    now.toString(),
  );
};

export const clearGoTrueCallbackAttempt = (): void => {
  sessionStorage.removeItem(GO_TRUE_CALLBACK_ATTEMPTED_AT_SESSION_STORAGE_KEY);
};

export const hasRecentGoTrueCallbackAttempt = (
  now: number = Date.now(),
): boolean => {
  const attemptedAt = readGoTrueCallbackAttemptedAt();

  return attemptedAt !== null && now - attemptedAt < GO_TRUE_CALLBACK_ATTEMPT_TTL_MS;
};

/**
 * True while this tab is mid-exchange: an apex session exists, CRM has no
 * session of its own yet, and the bridge is either about to be triggered or
 * has been triggered and the browser has not finished navigating to it.
 *
 * Callers use this to answer "is this user unauthenticated, or merely not
 * authenticated YET?" — a distinction the app previously could not make.
 */
export const isGoTrueBridgeInFlight = (now: number = Date.now()): boolean => {
  // Already exchanged. Nothing is in flight.
  if (isDefined(getTokenPair())) {
    return false;
  }

  // The server already said no, and said why. Show the form.
  if (hasBridgeReportedFailure()) {
    return false;
  }

  // No apex session to exchange — this really is a logged-out visitor.
  if (!hasGoTrueSentinelCookie()) {
    return false;
  }

  const attemptedAt = readGoTrueCallbackAttemptedAt();

  // Sentinel present, no attempt recorded yet: GoTrueCallbackRedirectEffect is
  // about to fire on this very mount. Suppressing the sign-in redirect for that
  // window is the whole point — it is the window the race lived in.
  if (attemptedAt === null) {
    return true;
  }

  return now - attemptedAt < GO_TRUE_BRIDGE_IN_FLIGHT_MS;
};

/** Test seam: forget the once-per-document `?ssoError=` capture. */
export const resetGoTrueBridgeFailureCaptureForTesting = (): void => {
  bridgeReportedFailureOnLoad = undefined;
};
