/**
 * useProjectionFreshness
 *
 * Polls the exe-db projection-status endpoint and derives a FreshnessState
 * for all known workers.  Components subscribe to a single worker by name;
 * if workerName is omitted, the "worst" state across all workers is returned.
 *
 * Polling interval: 60 s.
 * The hook does NOT throw — all errors result in { kind: 'unknown' } or
 * { kind: 'disconnected' }.
 *
 * Exposes a manual `refresh()` callback for the "Refresh now" button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  computeFreshnessState,
  type FreshnessState,
  type ProjectionWorkerStatus,
} from '@/information-banner/utils/computeFreshnessState';
import {
  fetchProjectionStatus,
  type ProjectionFetchResult,
  type ProjectionStatusResponse,
} from '@/information-banner/services/ProjectionStatusClient';

const POLL_INTERVAL_MS = 60_000;

const FRESHNESS_STATE_PRIORITY: Record<FreshnessState['kind'], number> = {
  disconnected: 4,
  error: 3,
  stale: 2,
  unknown: 1,
  fresh: 0,
};

const worstState = (states: FreshnessState[]): FreshnessState => {
  if (states.length === 0) return { kind: 'unknown' };
  return states.reduce((worst, current) =>
    FRESHNESS_STATE_PRIORITY[current.kind] >
    FRESHNESS_STATE_PRIORITY[worst.kind]
      ? current
      : worst,
  );
};

type UseProjectionFreshnessOptions = {
  /**
   * Name of a specific worker to monitor.
   * If omitted, returns the worst state across all workers.
   */
  workerName?: string;
};

type UseProjectionFreshnessResult = {
  freshnessState: FreshnessState;
  isLoading: boolean;
  /** Trigger an immediate re-fetch (for the "Refresh now" button). */
  refresh: () => void;
  /** True while a manual refresh is in flight. */
  isRefreshing: boolean;
};

export const useProjectionFreshness = ({
  workerName,
}: UseProjectionFreshnessOptions = {}): UseProjectionFreshnessResult => {
  const [fetchResult, setFetchResult] = useState<ProjectionFetchResult | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // oxlint-disable-next-line exe-crm/no-state-useref
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    const result = await fetchProjectionStatus();
    if (!cancelledRef.current) {
      setFetchResult(result);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    void load();

    const interval = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [load]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void (async () => {
      await load();
      setIsRefreshing(false);
    })();
  }, [load]);

  const freshnessState = (() => {
    // Not yet loaded
    if (fetchResult === null) {
      return { kind: 'unknown' } satisfies FreshnessState;
    }

    // URL not configured — treat as unknown (not an error)
    if (fetchResult.status === 'not-configured') {
      return { kind: 'unknown' } satisfies FreshnessState;
    }

    // Connection failed — distinct from stale
    if (fetchResult.status === 'disconnected') {
      return { kind: 'disconnected' } satisfies FreshnessState;
    }

    const statusMap: ProjectionStatusResponse = fetchResult.data;

    if (workerName !== undefined) {
      const worker: ProjectionWorkerStatus | undefined = statusMap[workerName];
      return computeFreshnessState(worker);
    }

    // Aggregate over all workers
    const states = Object.values(statusMap).map((w) =>
      computeFreshnessState(w),
    );
    return worstState(states);
  })();

  return { freshnessState, isLoading, refresh, isRefreshing };
};
