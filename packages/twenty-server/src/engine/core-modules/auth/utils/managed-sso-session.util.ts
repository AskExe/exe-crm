import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

/**
 * Parse MANAGED_SSO_ACCESS_TOKEN_MAX_AGE_SECONDS.
 *
 * This is the maximum age (in seconds) a MANAGED-SSO access token may reach
 * before CRM forces a central re-validation. It is OPT-IN and OFF by default so
 * existing deployments are unaffected:
 *   - unset / null / empty / whitespace-only -> 0 (disabled)
 *   - a non-integer, non-finite, or <= 0 value -> 0 (disabled)
 *   - a positive integer number of seconds -> that value
 *
 * Parsing is strict-but-safe: a typo can only DISABLE the guard, never enable a
 * surprising value.
 */
export const parseManagedSsoAccessTokenMaxAgeSeconds = (
  raw: string | undefined | null,
): number => {
  if (raw === undefined || raw === null) return 0;

  const trimmed = String(raw).trim();

  if (trimmed === '') return 0;

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
};

/**
 * True when a MANAGED-SSO access token has exceeded the configured max age and
 * must be re-validated centrally. When true, the caller rejects the request with
 * an UNAUTHENTICATED error; the frontend then renews, the managed renewal is
 * refused, and the user re-authenticates through GoTrue (honoring central
 * disable). Returns false (native behavior, fully backward compatible) unless
 * ALL of the following hold:
 *   - maxAgeSeconds > 0            (feature enabled)
 *   - exeOrgId is a non-empty string (managed enforcement on for this deployment)
 *   - authProvider === SSO        (only managed SSO sessions are affected)
 *   - iat is a finite number      (issued-at claim present)
 *   - nowSeconds - iat > maxAgeSeconds
 */
export const isManagedSsoAccessTokenStale = (params: {
  authProvider: AuthProviderEnum | undefined;
  iat: number | undefined;
  nowSeconds: number;
  exeOrgId: string | undefined | null;
  maxAgeSeconds: number;
}): boolean => {
  const { authProvider, iat, nowSeconds, exeOrgId, maxAgeSeconds } = params;

  if (!(maxAgeSeconds > 0)) return false;
  if (typeof exeOrgId !== 'string' || exeOrgId.trim() === '') return false;
  // AuthProviderEnum.SSO has the string value 'sso'.
  if (authProvider !== AuthProviderEnum.SSO) return false;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false;

  return nowSeconds - iat > maxAgeSeconds;
};
