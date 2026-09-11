import { ServiceUnavailableException } from '@nestjs/common';

import { BillingService } from 'src/engine/core-modules/billing/services/billing.service';

import { EnterprisePlanService } from './enterprise-plan.service';
import { readExeLicense } from './exe-license-authority';

describe('GoTrue-backed installation license enforcement', () => {
  const originalEnvironment = { ...process.env };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXE_LICENSE_KEY = 'exe_sk_test_installation';
    process.env.EXE_LICENSE_URL = 'https://licenses.example.test/auth/activate';
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    global.fetch = originalFetch;
  });

  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });

  it('asks the server authority using the installation key without changing device registration', async () => {
    reply({ valid: true, plan: 'enterprise', expiresAt: null });

    expect(await new EnterprisePlanService().isValid()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://licenses.example.test/auth/activate'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ apiKey: 'exe_sk_test_installation' }),
        redirect: 'error',
      }),
    );
  });

  it('does not retain enterprise access after the next authority read revokes it', async () => {
    reply({ valid: true, plan: 'enterprise', expiresAt: null });
    const service = new EnterprisePlanService();

    expect(await service.isValid()).toBe(true);
    reply({ valid: false, reason: 'inactive_license' });
    expect(await service.isValid()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires enterprise for enterprise methods while retaining valid-install billing feature policy', async () => {
    reply({ valid: true, plan: 'pro', expiresAt: null });
    const enterprise = new EnterprisePlanService();
    const billing = new BillingService();

    expect(await enterprise.hasValidEnterpriseKey()).toBe(false);
    expect(await enterprise.hasValidSignedEnterpriseKey()).toBe(false);
    expect(await enterprise.hasValidEnterpriseValidityToken()).toBe(false);
    expect(await billing.hasEntitlement('workspace', 'AI')).toBe(true);
    expect(await billing.canBillMeteredProduct('workspace', 'WORKFLOWS')).toBe(
      true,
    );
    expect(billing.isBillingEnabled()).toBe(false);
  });

  it.each([401, 403])('denies a definitive %s response', async (status) => {
    reply({}, status);

    expect(await readExeLicense()).toBeNull();
    expect(await new BillingService().hasEntitlement('workspace', 'AI')).toBe(
      false,
    );
  });

  it('denies an expired otherwise valid license', async () => {
    reply({
      valid: true,
      plan: 'enterprise',
      expiresAt: '2000-01-01T00:00:00Z',
    });

    expect(await readExeLicense()).toBeNull();
  });

  it.each([
    {},
    { valid: 'true', plan: 'enterprise', expiresAt: null },
    { valid: true, plan: 'unknown', expiresAt: null },
    { valid: true, plan: 'enterprise' },
    { valid: true, plan: 'enterprise', expiresAt: 'invalid-date' },
  ])('never grants access for malformed responses: %j', async (body) => {
    reply(body);

    await expect(readExeLicense()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('distinguishes an authority outage from an invalid license', async () => {
    reply({}, 503);

    await expect(readExeLicense()).rejects.toMatchObject({ status: 503 });
    fetchMock.mockRejectedValue(new Error('network failure'));
    await expect(readExeLicense()).rejects.toMatchObject({ status: 503 });
  });

  it('keeps public login display flags false during outages while actual feature checks report 503', async () => {
    reply({}, 503);
    const service = new EnterprisePlanService();

    expect(await service.hasValidEnterpriseKey()).toBe(false);
    expect(await service.hasValidSignedEnterpriseKey()).toBe(false);
    expect(await service.hasValidEnterpriseValidityToken()).toBe(false);
    await expect(service.isValid()).rejects.toMatchObject({ status: 503 });
  });

  it('never sends an installation secret to HTTP or credential-bearing URLs', async () => {
    for (const endpoint of [
      'http://licenses.example.test/auth/activate',
      'https://user:password@licenses.example.test/auth/activate',
    ]) {
      process.env.EXE_LICENSE_URL = endpoint;
      await expect(readExeLicense()).rejects.toMatchObject({ status: 503 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
