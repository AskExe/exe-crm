import { type Request } from 'express';

/**
 * Resolve the address of the peer we are willing to attribute a request to, for
 * abuse accounting (rate limits, lockouts, ban lists).
 *
 * WHY THIS EXISTS (bug 29837293)
 * ------------------------------
 * The obvious implementation — `req.headers['x-forwarded-for'].split(',')[0]` —
 * is wrong in both directions at once:
 *
 *  - It is CLIENT-SUPPLIED. Anything to the LEFT of the entries appended by our
 *    own trusted proxies was written by the caller. An attacker rotates
 *    `X-Forwarded-For` per request and every request lands in a fresh bucket,
 *    so a limiter keyed on it never fires. It fails to do the one job it has.
 *  - It is SHARED. When the header is absent or short, the first entry is the
 *    edge's own address, so unrelated users collapse into a single bucket and
 *    one abuser locks out everybody behind that hop.
 *
 * The correct rule is to count from the RIGHT. Each trusted hop APPENDS the
 * address it observed, so with `hops` trusted proxies in front of us the last
 * value we can believe is at `entries.length - hops`. Everything left of that
 * index is attacker-controlled and must never be used as a key.
 *
 * CONFIGURATION
 * -------------
 *  - `EXE_TRUSTED_PROXY_HOPS` (integer, default 0): how many proxies of our own
 *    sit between the internet and this process and append to
 *    `X-Forwarded-For`. On the Exe stack the chain is
 *    `cloudflared -> exe-sso-edge -> exe-crm`, i.e. 2. Default 0 means "trust
 *    nothing from headers" — the safe default for a directly exposed process.
 *  - `EXE_TRUST_CLOUDFLARE_IP` (`true`/`1`): use Cloudflare's
 *    `CF-Connecting-IP`. Cloudflare OVERWRITES this header on every proxied
 *    request, so it cannot be forged by the client — but only if the origin is
 *    unreachable except through Cloudflare. Opt-in for exactly that reason.
 *
 * When nothing is trusted we fall back to the real TCP peer
 * (`req.socket.remoteAddress`), which cannot be forged. Behind a proxy that
 * collapses everyone into one bucket, which is why this returns the bucket key
 * together with `isShared: true` so callers can decide whether an IP key is
 * meaningful at all.
 */
export type TrustedClientIp = {
  /** The key to account against. Never client-controlled. */
  ip: string;
  /**
   * True when `ip` is a proxy address rather than a distinct caller, i.e. many
   * unrelated users share this key. Callers that would lock a bucket out should
   * treat a shared key with much more care (or not lock out at all).
   */
  isShared: boolean;
  /** Where the value came from — useful in logs, never in decisions. */
  source: 'cf-connecting-ip' | 'x-forwarded-for' | 'socket';
};

const readHeader = (req: Request, name: string): string | undefined => {
  const raw = req.headers[name];

  if (Array.isArray(raw)) {
    return raw[0];
  }

  return raw;
};

const parseTrustedProxyHops = (): number => {
  const raw = process.env.EXE_TRUSTED_PROXY_HOPS;

  if (raw === undefined || raw === '') {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

const isCloudflareTrusted = (): boolean => {
  const raw = process.env.EXE_TRUST_CLOUDFLARE_IP;

  return raw === 'true' || raw === '1';
};

export const getTrustedClientIp = (req: Request): TrustedClientIp => {
  if (isCloudflareTrusted()) {
    const cfConnectingIp = readHeader(req, 'cf-connecting-ip')?.trim();

    if (cfConnectingIp) {
      return {
        ip: cfConnectingIp,
        isShared: false,
        source: 'cf-connecting-ip',
      };
    }
  }

  const hops = parseTrustedProxyHops();

  if (hops > 0) {
    const entries = (readHeader(req, 'x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    // Count from the RIGHT: each trusted hop appended one entry, so the last
    // value we can believe is `hops` from the end. A shorter header than the
    // configured chain means the request did NOT traverse the full chain, so
    // nothing in it is trustworthy — fall through to the socket.
    const index = entries.length - hops;

    if (index >= 0 && entries[index] !== undefined) {
      return {
        ip: entries[index],
        isShared: false,
        source: 'x-forwarded-for',
      };
    }
  }

  const socketAddress = req.socket?.remoteAddress;

  return {
    ip: socketAddress ?? 'unknown',
    // With no trusted-proxy configuration the socket peer is the edge itself
    // whenever this process sits behind one, so the key is shared.
    isShared: hops === 0 && !isCloudflareTrusted(),
    source: 'socket',
  };
};
