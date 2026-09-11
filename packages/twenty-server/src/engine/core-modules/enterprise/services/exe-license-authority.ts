import { ServiceUnavailableException } from '@nestjs/common';

type ExeLicense = {
  plan: 'free' | 'pro' | 'team' | 'agency' | 'enterprise';
  expiresAt: string | null;
};

const PLANS = new Set(['free', 'pro', 'team', 'agency', 'enterprise']);

/** Resolve the installation key through the gateway's fresh GoTrue authority. */
export const readExeLicense = async (): Promise<ExeLicense | null> => {
  const apiKey = process.env.EXE_LICENSE_KEY ?? process.env.ENTERPRISE_KEY;
  const endpoint =
    process.env.EXE_LICENSE_URL ?? 'https://cloud.askexe.com/auth/activate';

  if (!apiKey) {
    throw new ServiceUnavailableException(
      'License verification is not configured',
    );
  }

  try {
    const url = new URL(endpoint);

    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('License verification requires HTTPS');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      throw new Error('License authority unavailable');
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null || !('valid' in data)) {
      throw new Error('Invalid license authority response');
    }

    if (data.valid === false) {
      return null;
    }

    if (
      data.valid !== true ||
      !('plan' in data) ||
      typeof data.plan !== 'string' ||
      !PLANS.has(data.plan) ||
      !('expiresAt' in data) ||
      (data.expiresAt !== null &&
        (typeof data.expiresAt !== 'string' ||
          !Number.isFinite(Date.parse(data.expiresAt))))
    ) {
      throw new Error('Invalid license authority response');
    }

    if (data.expiresAt !== null && Date.parse(data.expiresAt) <= Date.now()) {
      return null;
    }

    return {
      plan: data.plan as ExeLicense['plan'],
      expiresAt: data.expiresAt,
    };
  } catch {
    // Keep outages distinguishable from a definitive invalid entitlement.
    // Neither condition grants access, and no old successful response is cached.
    throw new ServiceUnavailableException(
      'License verification is temporarily unavailable',
    );
  }
};
