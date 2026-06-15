import {
  computeFreshnessState,
  type ProjectionWorkerStatus,
} from '@/information-banner/utils/computeFreshnessState';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const recentIso = (): string => new Date(Date.now() - 30_000).toISOString(); // 30 s ago
const oldIso = (): string =>
  new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago

const baseStatus = (): ProjectionWorkerStatus => ({
  backlog: 0,
  last_processed: recentIso(),
  failed_count: 0,
  retry_count: 0,
  last_error: null,
});

// ─── null / undefined input ───────────────────────────────────────────────────

describe('computeFreshnessState — null/undefined input', () => {
  it('returns unknown when status is null', () => {
    const result = computeFreshnessState(null);
    expect(result.kind).toBe('unknown');
  });

  it('returns unknown when status is undefined', () => {
    const result = computeFreshnessState(undefined);
    expect(result.kind).toBe('unknown');
  });
});

// ─── error state ─────────────────────────────────────────────────────────────

describe('computeFreshnessState — error', () => {
  it('returns error when last_error is non-empty', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      last_error: 'DB connection refused',
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.last_error).toBe('DB connection refused');
    }
  });

  it('error takes priority over high backlog', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 10_000,
      last_error: 'Timeout',
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('error');
  });

  it('returns fresh (not error) when last_error is whitespace-only', () => {
    // Whitespace-only is treated as no error
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      last_error: '   ',
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('fresh');
  });
});

// ─── stale state ─────────────────────────────────────────────────────────────

describe('computeFreshnessState — stale', () => {
  it('returns stale when backlog exceeds threshold', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 51,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('stale');
    if (result.kind === 'stale') {
      expect(result.backlog).toBe(51);
    }
  });

  it('returns stale when last_processed is older than 5 minutes', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      last_processed: oldIso(),
      backlog: 0,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('stale');
  });

  it('returns stale (not error) with high backlog and no error', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 200,
      last_error: null,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('stale');
  });
});

// ─── unknown state ────────────────────────────────────────────────────────────

describe('computeFreshnessState — unknown', () => {
  it('returns unknown when last_processed is null and no error', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      last_processed: null,
      last_error: null,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('unknown');
  });
});

// ─── fresh state ─────────────────────────────────────────────────────────────

describe('computeFreshnessState — fresh', () => {
  it('returns fresh when backlog is low and last_processed is recent', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 0,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('fresh');
    if (result.kind === 'fresh') {
      expect(result.last_processed).toBeTruthy();
    }
  });

  it('returns fresh when backlog is exactly at threshold (50)', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 50,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('fresh');
  });

  it('returns stale when backlog is 51 (just over threshold)', () => {
    const status: ProjectionWorkerStatus = {
      ...baseStatus(),
      backlog: 51,
    };
    const result = computeFreshnessState(status);
    expect(result.kind).toBe('stale');
  });
});

// ─── disconnected state (handled at hook level, not by computeFreshnessState)
//     The `disconnected` kind is returned by useProjectionFreshness when the
//     fetch itself fails.  computeFreshnessState only handles worker-level
//     status objects.  This section documents that contract for clarity.

describe('computeFreshnessState — disconnected is not returned', () => {
  it('does not produce disconnected — that is the hook responsibility', () => {
    // computeFreshnessState only returns fresh/stale/error/unknown
    const allInputs: (ProjectionWorkerStatus | null | undefined)[] = [
      null,
      undefined,
      baseStatus(),
      { ...baseStatus(), last_error: 'boom' },
      { ...baseStatus(), backlog: 999 },
      { ...baseStatus(), last_processed: null },
    ];
    for (const input of allInputs) {
      const result = computeFreshnessState(input);
      expect(result.kind).not.toBe('disconnected');
    }
  });
});
