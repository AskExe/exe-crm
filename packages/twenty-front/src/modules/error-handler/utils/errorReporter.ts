import { REACT_APP_SERVER_BASE_URL } from '~/config';

type ErrorReport = {
  service: string;
  level: 'error' | 'fatal' | 'warn';
  type: 'frontend';
  message: string;
  stack: string | null;
  url: string;
  method: string;
  status_code: number;
  user_id: string;
  release: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

const DEBOUNCE_MS = 30_000;
const recentErrors = new Map<string, number>();

const isDuplicate = (message: string): boolean => {
  const now = Date.now();
  const lastSent = recentErrors.get(message);

  if (lastSent && now - lastSent < DEBOUNCE_MS) {
    return true;
  }

  recentErrors.set(message, now);

  // Cleanup old entries to prevent memory leak
  if (recentErrors.size > 100) {
    const cutoff = now - DEBOUNCE_MS;

    for (const [key, timestamp] of recentErrors) {
      if (timestamp < cutoff) {
        recentErrors.delete(key);
      }
    }
  }

  return false;
};

export const reportError = (
  error: Error,
  metadata: Record<string, unknown> = {},
  userId = '',
): void => {
  if (isDuplicate(error.message)) {
    return;
  }

  const payload: ErrorReport = {
    service: 'exe-crm',
    level: 'error',
    type: 'frontend',
    message: error.message,
    stack: error.stack ?? null,
    url: window.location.href,
    method: 'GET',
    status_code: 0,
    user_id: userId,
    release: process.env.REACT_APP_VERSION ?? 'unknown',
    timestamp: new Date().toISOString(),
    metadata,
  };

  // Fire-and-forget — never let error reporting break the app
  fetch(`${REACT_APP_SERVER_BASE_URL}/api/errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silently ignore reporting failures
  });
};
