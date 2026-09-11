import { signOutViaCentralPage } from '@/auth/utils/signOutViaCentralPage';
import { cookieStorage } from '~/utils/cookie-storage';

jest.mock('~/utils/cookie-storage', () => ({
  cookieStorage: { removeItem: jest.fn() },
}));
jest.mock('@/auth/utils/getRegistrableDomain', () => ({
  getRegistrableDomain: () => 'customer.example.test',
}));

it.each([false, true])(
  'clears the CRM credential before central navigation even when cleanup fails: %s',
  async (fails) => {
    const order: string[] = [];
    const signOut = jest.fn(async () => {
      order.push('native');
      if (fails) throw new Error('cache unavailable');
    });
    (cookieStorage.removeItem as jest.Mock).mockImplementation(() => {
      order.push('cookie');
    });
    const navigate = jest.fn(() => {
      order.push('navigate');
    });
    await signOutViaCentralPage(signOut, navigate);
    expect(order).toEqual(['native', 'cookie', 'navigate']);
    expect(cookieStorage.removeItem).toHaveBeenCalledWith('tokenPair');
    expect(navigate).toHaveBeenCalledWith(
      'https://auth.customer.example.test/logout',
    );
  },
);
