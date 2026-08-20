import {
  isManagedSsoAccessTokenStale,
  parseManagedSsoAccessTokenMaxAgeSeconds,
} from 'src/engine/core-modules/auth/utils/managed-sso-session.util';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

describe('parseManagedSsoAccessTokenMaxAgeSeconds', () => {
  it('should return 0 when the env var is undefined', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds(undefined)).toBe(0);
  });

  it('should return 0 when the env var is null', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds(null)).toBe(0);
  });

  it.each(['', '   '])(
    'should return 0 for whitespace-only input %p',
    (raw) => {
      expect(parseManagedSsoAccessTokenMaxAgeSeconds(raw)).toBe(0);
    },
  );

  it('should return 0 for non-numeric input', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('abc')).toBe(0);
  });

  it('should return 0 for zero', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('0')).toBe(0);
  });

  it('should return 0 for negative values', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('-5')).toBe(0);
  });

  it('should return 0 for non-integer values', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('1.5')).toBe(0);
  });

  it('should parse a positive integer', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('300')).toBe(300);
  });

  it('should parse a positive integer with surrounding whitespace', () => {
    expect(parseManagedSsoAccessTokenMaxAgeSeconds('  600 ')).toBe(600);
  });
});

describe('isManagedSsoAccessTokenStale', () => {
  const NOW_SECONDS = 1_000_000;

  it('should return false when the guard is disabled, even for a very old token', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 100_000,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 0,
      }),
    ).toBe(false);
  });

  it('should return false when exeOrgId is undefined', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 301,
        nowSeconds: NOW_SECONDS,
        exeOrgId: undefined,
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return false when exeOrgId is an empty string', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 301,
        nowSeconds: NOW_SECONDS,
        exeOrgId: '',
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return false for a password session even when old, managed, and enabled', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.Password,
        iat: NOW_SECONDS - 301,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return false when iat is undefined', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: undefined,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return false when the token is fresh', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 299,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return false when the token age exactly equals the max age', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 300,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 300,
      }),
    ).toBe(false);
  });

  it('should return true when a managed SSO token exceeds the max age', () => {
    expect(
      isManagedSsoAccessTokenStale({
        authProvider: AuthProviderEnum.SSO,
        iat: NOW_SECONDS - 301,
        nowSeconds: NOW_SECONDS,
        exeOrgId: 'exe-org',
        maxAgeSeconds: 300,
      }),
    ).toBe(true);
  });
});
