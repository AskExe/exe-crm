/**
 * computeFreshnessState
 *
 * Pure function — no side effects, easy to unit-test.
 *
 * Derives a FreshnessState from the raw projection-status API response for a
 * single worker.  The caller (useProjectionFreshness) is responsible for
 * fetching and passing the payload.
 *
 * Contract (from exe-db GET /api/projections/status):
 *   {
 *     backlog: number;          // events queued but not yet processed
 *     last_processed: string;   // ISO-8601 timestamp of last successful event
 *     failed_count: number;     // total failed events (lifetime)
 *     retry_count: number;      // events currently being retried
 *     last_error: string | null;
 *   }
 */

export type ProjectionWorkerStatus = {
  backlog: number;
  last_processed: string | null;
  failed_count: number;
  retry_count: number;
  last_error: string | null;
};

export type FreshnessState =
  | { kind: 'fresh'; last_processed: string }
  | { kind: 'stale'; last_processed: string | null; backlog: number }
  | { kind: 'error'; last_error: string; last_processed: string | null }
  | { kind: 'unknown' };

/**
 * Thresholds
 *
 * STALE_BACKLOG_THRESHOLD: a backlog above this value means we show the stale
 * banner even if last_processed is recent.  Tune at deploy time if needed.
 *
 * STALE_AGE_MS: if the last processed event is older than this, we consider
 * the data stale regardless of backlog.
 */
const STALE_BACKLOG_THRESHOLD = 50;
const STALE_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const computeFreshnessState = (
  status: ProjectionWorkerStatus | null | undefined,
): FreshnessState => {
  // Unavailable — endpoint didn't respond or returned null
  if (status == null) {
    return { kind: 'unknown' };
  }

  // Error state takes priority: last_error present means something broke
  if (status.last_error != null && status.last_error.trim().length > 0) {
    return {
      kind: 'error',
      last_error: status.last_error,
      last_processed: status.last_processed,
    };
  }

  // Stale: backlog is high
  if (status.backlog > STALE_BACKLOG_THRESHOLD) {
    return {
      kind: 'stale',
      last_processed: status.last_processed,
      backlog: status.backlog,
    };
  }

  // Stale: last_processed is too old
  if (status.last_processed != null) {
    const age = Date.now() - new Date(status.last_processed).getTime();
    if (age > STALE_AGE_MS) {
      return {
        kind: 'stale',
        last_processed: status.last_processed,
        backlog: status.backlog,
      };
    }
  }

  // No last_processed at all and no error — treat as unknown (not fake-green)
  if (status.last_processed == null) {
    return { kind: 'unknown' };
  }

  // All good
  return { kind: 'fresh', last_processed: status.last_processed };
};
