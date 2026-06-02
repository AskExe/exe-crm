import { currentUserState } from '@/auth/states/currentUserState';
import { reportError } from '@/error-handler/utils/errorReporter';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useEffect } from 'react';

// Installs global window.onerror + window.onunhandledrejection handlers
// that forward errors to exe-monitor-hub via the backend proxy.
export const GlobalErrorHandlerEffect = () => {
  const currentUser = useAtomStateValue(currentUserState);
  const userId = currentUser?.id ?? '';

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || 'Unknown error');

      reportError(error, { source: 'window.onerror' }, userId);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const error =
        reason instanceof Error
          ? reason
          : new Error(String(reason ?? 'Unhandled promise rejection'));

      reportError(error, { source: 'unhandledrejection' }, userId);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [userId]);

  return null;
};
