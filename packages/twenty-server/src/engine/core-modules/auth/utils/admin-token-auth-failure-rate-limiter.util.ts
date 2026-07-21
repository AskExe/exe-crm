import { type Request } from 'express';

export const ADMIN_TOKEN_AUTH_FAILURE_RATE_LIMIT_ERROR =
  'Too many requests - try again later.';

export class AdminTokenAuthFailureRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 60_000,
  ) {}

  consumeFailure(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(ip) ?? [];
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    if (recent.length >= this.maxAttempts) {
      this.attempts.set(ip, recent);

      return true;
    }

    recent.push(now);
    this.attempts.set(ip, recent);

    return false;
  }
}

export const getAdminTokenClientIp = (req: Request): string => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedForHeader = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;

  return (
    forwardedForHeader?.split(',')[0]?.trim() ??
    req.socket.remoteAddress ??
    'unknown'
  );
};
