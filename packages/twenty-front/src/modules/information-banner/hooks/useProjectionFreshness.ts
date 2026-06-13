/**
 * useProjectionFreshness
 *
 * Polls the exe-db projection-status endpoint and derives a FreshnessState
 * for all known workers.  Components subscribe to a single worker by name;
 * if workerName is omitted, the "worst" state across all workers is returned.
 *
 * Polling interval: 60 s.
 * The hook does NOT throw — all errors result in { kind: 'unknown' }.
 */

import { useEffect, useState } from 'react';

import {
  computeFreshnessState,
  type FreshnessState,
  type ProjectionWorkerStatus,
} from '@/information-banner/utils/computeFreshnessState';
import {
  fetchProjectionStatus,
  type ProjectionStatusResponse,
} from '@/information-banner/services/ProjectionStatusClient';

const POLL_INTERVAL_MS = 60_000;

const FRESHNESS_STATE_PRIORITY: Record<FreshnessState['kind'], number> = {
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
};

export const useProjectionFreshness = ({
  workerName,
}: UseProjectionFreshnessOptions = {}): UseProjectionFreshnessResult => {
  const [statusMap, setStatusMap] = useState<ProjectionStatusResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const result = await fetchProjectionStatus();
      if (!cancelled) {
        setStatusMap(result);
        setIsLoading(false);
      }
    };

    void load();

    const interval = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const freshnessState = (() => {
    if (statusMap === null) {
      return { kind: 'unknown' } satisfies FreshnessState;
    }

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

  return { freshnessState, isLoading };
};
