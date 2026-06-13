/**
 * InformationBannerProjectionFreshness
 *
 * Shows a data-freshness / staleness banner driven by the exe-db
 * projection-status endpoint.
 *
 * States:
 *  fresh   → no banner (optionally: subtle "Updated {relative}" chip)
 *  stale   → "⚠ Data as of {last_processed} · {backlog} events behind"
 *  error   → "⚠ Projection error: {last_error}"
 *  unknown → "Freshness unknown" (neutral, never fake-green)
 *
 * Wire-up note:
 *  The exe-db URL must be configured via REACT_APP_EXE_DB_BASE_URL at deploy
 *  time.  Without it, all requests fail gracefully and the banner shows
 *  "Freshness unknown" rather than a fake healthy state.
 */

import { useProjectionFreshness } from '@/information-banner/hooks/useProjectionFreshness';
import { styled } from '@linaria/react';
import { Banner } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

// ─── Styled helpers ──────────────────────────────────────────────────────────

const StyledFreshnessBannerWrapper = styled.div`
  height: 40px;
  position: relative;

  &:empty {
    height: 0;
  }
`;

const StyledNeutralBanner = styled(Banner)`
  background: ${themeCssVariables.background.tertiary};
  color: ${themeCssVariables.font.color.secondary};
`;

const StyledBannerText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

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
  const { freshnessState, isLoading } = useProjectionFreshness({ workerName });

  // Don't flash anything while loading the first response
  if (isLoading) return null;

  switch (freshnessState.kind) {
    case 'fresh': {
      // Fresh: show a subtle chip so the user knows data is live.
      // Keep it unobtrusive — no red/orange, no action required.
      return (
        <StyledFreshnessBannerWrapper>
          <StyledNeutralBanner>
            <StyledBannerText>
              Updated {formatRelative(freshnessState.last_processed)}
            </StyledBannerText>
          </StyledNeutralBanner>
        </StyledFreshnessBannerWrapper>
      );
    }

    case 'stale': {
      const lastProcessedText =
        freshnessState.last_processed != null
          ? `Data as of ${formatRelative(freshnessState.last_processed)}`
          : 'Last sync time unknown';

      return (
        <StyledFreshnessBannerWrapper>
          <Banner variant="default">
            <StyledBannerText>
              ⚠ {lastProcessedText} · {freshnessState.backlog} events behind
            </StyledBannerText>
          </Banner>
        </StyledFreshnessBannerWrapper>
      );
    }

    case 'error': {
      return (
        <StyledFreshnessBannerWrapper>
          <Banner variant="danger">
            <StyledBannerText>
              ⚠ Projection error: {freshnessState.last_error}
            </StyledBannerText>
          </Banner>
        </StyledFreshnessBannerWrapper>
      );
    }

    case 'unknown': {
      // Neutral — never fake-green. The user knows the status is genuinely
      // unavailable rather than healthy.
      return (
        <StyledFreshnessBannerWrapper>
          <StyledNeutralBanner>
            <StyledBannerText>Freshness unknown</StyledBannerText>
          </StyledNeutralBanner>
        </StyledFreshnessBannerWrapper>
      );
    }

    default: {
      // TypeScript exhaustiveness guard — unreachable at runtime
      return null;
    }
  }
};
