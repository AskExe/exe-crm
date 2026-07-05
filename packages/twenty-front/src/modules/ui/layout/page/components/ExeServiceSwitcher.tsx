import { currentUserState } from '@/auth/states/currentUserState';
import { useShowAuthModal } from '@/ui/layout/hooks/useShowAuthModal';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useEffect } from 'react';

/**
 * Loads the <exe-service-switcher> Web Component and renders it at the top
 * of the CRM layout. Only visible to authenticated users.
 *
 * The component is a self-contained Web Component with Shadow DOM, shipped as
 * a static JS file at /exe-service-switcher.js (in public/).
 */
export const ExeServiceSwitcher = () => {
  const showAuthModal = useShowAuthModal();
  const currentUser = useAtomStateValue(currentUserState);

  useEffect(() => {
    if (customElements.get('exe-service-switcher')) return;
    const script = document.createElement('script');
    script.src = '/exe-service-switcher.js';
    document.head.appendChild(script);
  }, []);

  // Don't render on auth/login screens
  if (showAuthModal) return null;

  return <exe-service-switcher current="CRM" user={currentUser?.email ?? ''} />;
};
