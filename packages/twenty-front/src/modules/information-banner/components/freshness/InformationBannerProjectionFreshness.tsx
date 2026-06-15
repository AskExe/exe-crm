/**
 * InformationBannerProjectionFreshness
 *
 * Shows a data-freshness / staleness banner driven by the exe-db
 * projection-status endpoint.
 *
 * States:
 *  fresh        → no banner (data is current — nothing to show)
 *  stale        → warning: "Data last synced X ago — may be outdated"  [Refresh now]
 *  error        → danger: "Projection error: {last_error}"             [Refresh now]
 *  disconnected → danger: "Unable to reach data source — showing cached data" [Retry]
 *  unknown      → no banner (either not configured or genuinely indeterminate)
 *
 * Wire-up note:
 *  The exe-db URL must be configured via REACT_APP_EXE_DB_BASE_URL at deploy
 *  time.  Without it, all requests return "not-configured" and no banner is shown.
 */

import { InformationBanner } from '@/information-banner/components/InformationBanner';
import { useProjectionFreshness } from '@/information-banner/hooks/useProjectionFreshness';
import { IconRefresh } from 'twenty-ui/display';

const COMPONENT_INSTANCE_ID = 'information-banner-projection-freshness';

// ─── Relative-time formatter (no dep on date-fns) ────────────────────────────

const formatRelative = (isoTimestamp: string): string => {
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  const seconds = Math.round(ageMs / 1000);
  if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second');

  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');

  const days = Math.round(hours / 24);
  return rtf.format(-days, 'day');
};

// ─── Component ───────────────────────────────────────────────────────────────

type InformationBannerProjectionFreshnessProps = {
  /**
   * Optional: monitor a specific projection worker by name.
   * Defaults to the worst state across all workers.
   */
  workerName?: string;
};

export const InformationBannerProjectionFreshness = ({
  workerName,
}: InformationBannerProjectionFreshnessProps) => {
  const { freshnessState, isLoading, refresh, isRefreshing } =
    useProjectionFreshness({ workerName });

  // Don't flash anything while loading the first response
  if (isLoading) return null;

  switch (freshnessState.kind) {
    case 'fresh':
    case 'unknown': {
      // Fresh: data is current — no banner needed.
      // Unknown: not configured or indeterminate — no banner either.
      return null;
    }

    case 'stale': {
      const lastProcessedText =
        freshnessState.last_processed != null
          ? `Data last synced ${formatRelative(freshnessState.last_processed)} — may be outdated`
          : 'Last sync time unknown — data may be outdated';

      return (
        <InformationBanner
          componentInstanceId={COMPONENT_INSTANCE_ID}
          variant="default"
          message={lastProcessedText}
          buttonTitle="Refresh now"
          buttonIcon={IconRefresh}
          buttonOnClick={refresh}
          isButtonDisabled={isRefreshing}
        />
      );
    }

    case 'error': {
      return (
        <InformationBanner
          componentInstanceId={COMPONENT_INSTANCE_ID}
          variant="danger"
          message={`Projection error: ${freshnessState.last_error}`}
          buttonTitle="Refresh now"
          buttonIcon={IconRefresh}
          buttonOnClick={refresh}
          isButtonDisabled={isRefreshing}
        />
      );
    }

    case 'disconnected': {
      return (
        <InformationBanner
          componentInstanceId={COMPONENT_INSTANCE_ID}
          variant="danger"
          message="Unable to reach data source — showing cached data"
          buttonTitle="Retry"
          buttonIcon={IconRefresh}
          buttonOnClick={refresh}
          isButtonDisabled={isRefreshing}
        />
      );
    }

    default: {
      // TypeScript exhaustiveness guard — unreachable at runtime
      return null;
    }
  }
};
