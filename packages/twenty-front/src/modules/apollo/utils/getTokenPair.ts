import { isDefined } from 'twenty-shared/utils';
import { type AuthTokenPair } from '~/generated-metadata/graphql';
import { cookieStorage } from '~/utils/cookie-storage';
import { isValidAuthTokenPair } from './isValidAuthTokenPair';

/**
 * Read tokenPair directly from document.cookie as a fallback.
 * js-cookie's Cookies.get() can silently fail on certain cookie encodings
 * (mixed encoded/unencoded values, domain mismatches). This raw reader
 * handles both encoded and unencoded cookie values.
 */
function readTokenPairRaw(): string | undefined {
  try {
    const match = document.cookie
      .split(';')
      .find((c) => c.trim().startsWith('tokenPair='));

    if (!match) return undefined;

    const rawValue = match.trim().substring('tokenPair='.length);

    if (!rawValue || rawValue.length === 0) return undefined;

    // Try decoding (for URL-encoded cookies set via js-cookie or encodeURIComponent)
    try {
      return decodeURIComponent(rawValue);
    } catch {
      // Already unencoded
      return rawValue;
    }
  } catch {
    return undefined;
  }
}

export const getTokenPair = (): AuthTokenPair | undefined => {
  // Primary: js-cookie via cookieStorage
  let stringTokenPair = cookieStorage.getItem('tokenPair');

  // Fallback: read directly from document.cookie (bypasses js-cookie encoding issues)
  if (!isDefined(stringTokenPair) || stringTokenPair.length === 0) {
    stringTokenPair = readTokenPairRaw();
  }

  if (!isDefined(stringTokenPair) || stringTokenPair.length === 0) {
    return undefined;
  }

  try {
    const parsedTokenPair = JSON.parse(stringTokenPair);

    if (!isValidAuthTokenPair(parsedTokenPair)) {
      cookieStorage.removeItem('tokenPair');
      return undefined;
    }

    return parsedTokenPair;
  } catch {
    cookieStorage.removeItem('tokenPair');
    return undefined;
  }
};
