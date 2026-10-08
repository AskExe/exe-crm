import {
  REACT_APP_COMPANY_AUTH_ORIGIN,
  REACT_APP_COMPANY_EDITOR_ENABLED,
} from '~/config';
import { getRegistrableDomain } from '@/auth/utils/getRegistrableDomain';
import { cookieStorage } from '~/utils/cookie-storage';

export const signOutViaCentralPage = async (
  signOut: () => Promise<void>,
  navigate: (url: string) => void = (url) => window.location.assign(url),
) => {
  try {
    await signOut();
  } catch {
    // A cache/captcha cleanup failure must not strand the browser signed in.
    // Drop the persisted CRM credential before leaving for central logout.
  }
  cookieStorage.removeItem('tokenPair');
  if (REACT_APP_COMPANY_EDITOR_ENABLED) {
    if (
      !REACT_APP_COMPANY_AUTH_ORIGIN ||
      !/^https:\/\/auth\.[a-z0-9.-]+$/.test(REACT_APP_COMPANY_AUTH_ORIGIN)
    )
      throw new Error('Configured company auth origin unavailable');
    navigate(REACT_APP_COMPANY_AUTH_ORIGIN + '/logout');
    return;
  }
  const domain = getRegistrableDomain(window.location.hostname);
  navigate(`https://auth.${domain}/logout`);
};
