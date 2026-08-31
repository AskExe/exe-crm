import { type Request } from 'express';

import { getTrustedClientIp } from 'src/utils/get-trusted-client-ip';

const buildRequest = ({
  forwardedFor,
  cfConnectingIp,
  remoteAddress = '172.16.0.1',
}: {
  forwardedFor?: string;
  cfConnectingIp?: string;
  remoteAddress?: string;
} = {}): Request =>
  ({
    headers: {
      ...(forwardedFor !== undefined
        ? { 'x-forwarded-for': forwardedFor }
        : {}),
      ...(cfConnectingIp !== undefined
        ? { 'cf-connecting-ip': cfConnectingIp }
        : {}),
    },
    socket: { remoteAddress },
  }) as unknown as Request;

describe('getTrustedClientIp', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXE_TRUSTED_PROXY_HOPS;
    delete process.env.EXE_TRUST_CLOUDFLARE_IP;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('with no trusted proxy configured', () => {
    it('should ignore X-Forwarded-For entirely', () => {
      const result = getTrustedClientIp(
        buildRequest({ forwardedFor: '203.0.113.9' }),
      );

      expect(result.ip).toBe('172.16.0.1');
      expect(result.source).toBe('socket');
    });

    it('should mark the socket key as shared', () => {
      expect(
        getTrustedClientIp(buildRequest({ forwardedFor: '203.0.113.9' }))
          .isShared,
      ).toBe(true);
    });

    it('should ignore CF-Connecting-IP until it is opted into', () => {
      expect(
        getTrustedClientIp(buildRequest({ cfConnectingIp: '203.0.113.9' })).ip,
      ).toBe('172.16.0.1');
    });
  });

  describe('with EXE_TRUSTED_PROXY_HOPS', () => {
    it('should count from the right, not the left', () => {
      process.env.EXE_TRUSTED_PROXY_HOPS = '2';

      const result = getTrustedClientIp(
        buildRequest({
          forwardedFor: '10.0.0.99, 203.0.113.7, 192.168.0.1',
        }),
      );

      expect(result.ip).toBe('203.0.113.7');
      expect(result.source).toBe('x-forwarded-for');
    });

    it('should ignore a client-forged entry to the left of the trusted hops', () => {
      process.env.EXE_TRUSTED_PROXY_HOPS = '2';

      const forged = getTrustedClientIp(
        buildRequest({
          forwardedFor: 'attacker-chosen, 203.0.113.7, 192.168.0.1',
        }),
      );
      const honest = getTrustedClientIp(
        buildRequest({ forwardedFor: '203.0.113.7, 192.168.0.1' }),
      );

      expect(forged.ip).toBe(honest.ip);
    });

    it('should fall back to the socket when the chain is shorter than configured', () => {
      process.env.EXE_TRUSTED_PROXY_HOPS = '3';

      const result = getTrustedClientIp(
        buildRequest({ forwardedFor: '203.0.113.7' }),
      );

      expect(result.ip).toBe('172.16.0.1');
      expect(result.source).toBe('socket');
    });

    it('should fall back to the socket when the header is absent', () => {
      process.env.EXE_TRUSTED_PROXY_HOPS = '2';

      expect(getTrustedClientIp(buildRequest()).source).toBe('socket');
    });

    it.each([['not-a-number'], ['-1'], ['']])(
      'should treat %p as no trusted hops',
      (value) => {
        process.env.EXE_TRUSTED_PROXY_HOPS = value;

        expect(
          getTrustedClientIp(buildRequest({ forwardedFor: '203.0.113.9' }))
            .source,
        ).toBe('socket');
      },
    );
  });

  describe('with EXE_TRUST_CLOUDFLARE_IP', () => {
    it('should prefer CF-Connecting-IP', () => {
      process.env.EXE_TRUST_CLOUDFLARE_IP = 'true';

      const result = getTrustedClientIp(
        buildRequest({
          cfConnectingIp: '203.0.113.44',
          forwardedFor: 'attacker-chosen, 192.168.0.1',
        }),
      );

      expect(result.ip).toBe('203.0.113.44');
      expect(result.source).toBe('cf-connecting-ip');
    });

    it('should not fall back to a forged X-Forwarded-For when the header is absent', () => {
      process.env.EXE_TRUST_CLOUDFLARE_IP = 'true';

      expect(
        getTrustedClientIp(buildRequest({ forwardedFor: 'attacker-chosen' }))
          .source,
      ).toBe('socket');
    });
  });
});
