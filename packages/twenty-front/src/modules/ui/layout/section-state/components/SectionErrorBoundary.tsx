import { reportError } from '@/error-handler/utils/errorReporter';
import {
  SectionStateDisplay,
  type SectionStateVariant,
} from '@/ui/layout/section-state/components/SectionStateDisplay';
import { type ErrorInfo, type ReactNode, useCallback } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

type SectionErrorBoundaryProps = {
  children: ReactNode;
  /**
   * Extra keys whose changes reset the boundary (e.g. record id, widget id).
   */
  resetKeys?: unknown[];
  /**
   * Optional section label for error reporting.
   */
  sectionName?: string;
};

const isNetworkError = (error: Error): boolean => {
  const msg = error.message?.toLowerCase() ?? '';

  return (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout') ||
    error.name === 'TypeError' && msg.includes('fetch')
  );
};

type SectionErrorFallbackProps = FallbackProps;

const SectionErrorFallback = ({ error, resetErrorBoundary }: SectionErrorFallbackProps) => {
  const variant: SectionStateVariant = isNetworkError(error)
    ? 'connectionError'
    : 'error';

  return (
    <SectionStateDisplay
      variant={variant}
      onRetry={resetErrorBoundary}
    />
  );
};

export const SectionErrorBoundary = ({
  children,
  resetKeys,
  sectionName,
}: SectionErrorBoundaryProps) => {
  const handleError = useCallback(
    (error: Error, info: ErrorInfo) => {
      reportError(error, {
        source: 'section-error-boundary',
        section: sectionName,
        componentStack: info.componentStack ?? undefined,
      });
    },
    [sectionName],
  );

  return (
    <ErrorBoundary
      FallbackComponent={SectionErrorFallback}
      onError={handleError}
      resetKeys={resetKeys}
    >
      {children}
    </ErrorBoundary>
  );
};
