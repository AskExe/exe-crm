/**
 * ProjectionStatusClient
 *
 * Thin REST client for the exe-db projection-status endpoint.
 *
 * Endpoint contract (exe-db):
 *   GET /api/projections/status
 *   → { [workerName: string]: ProjectionWorkerStatus }
 *
 * Configuration:
 *   The base URL is read from the environment variable
 *   REACT_APP_EXE_DB_BASE_URL at build time, falling back to the window env
 *   override (same pattern as REACT_APP_SERVER_BASE_URL in config/index.ts).
 *
 *   ⚠ DEPLOY NOTE: Set REACT_APP_EXE_DB_BASE_URL (or window._env_.REACT_APP_EXE_DB_BASE_URL)
 *   to the exe-db service URL before deploying.  Without this, the client
 *   will use the fallback empty string and all fetches will fail gracefully
 *   (returning null, which renders "Freshness unknown").
 */

import { type ProjectionWorkerStatus } from '@/information-banner/utils/computeFreshnessState';

export type ProjectionStatusResponse = Record<string, ProjectionWorkerStatus>;

const getExeDbBaseUrl = (): string => {
  const w = window as Window &
    typeof globalThis & {
      _env_?: Record<string, string | undefined>;
    };
  return (
    w._env_?.REACT_APP_EXE_DB_BASE_URL ??
    (typeof process !== 'undefined'
      ? (process.env.REACT_APP_EXE_DB_BASE_URL ?? '')
      : '')
  );
};

export const fetchProjectionStatus =
  async (): Promise<ProjectionStatusResponse | null> => {
    const baseUrl = getExeDbBaseUrl();
    if (!baseUrl) {
      // No URL configured — return null so the banner shows "Freshness unknown"
      return null;
    }

    try {
      const response = await fetch(`${baseUrl}/api/projections/status`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // Short timeout so stale-data detection doesn't block the UI
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const json: unknown = await response.json();

      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return null;
      }

      return json as ProjectionStatusResponse;
    } catch {
      // Network error, timeout, CORS, etc. — degrade gracefully
      return null;
    }
  };
