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
  const domain = getRegistrableDomain(window.location.hostname);
  navigate(`https://auth.${domain}/logout`);
};
