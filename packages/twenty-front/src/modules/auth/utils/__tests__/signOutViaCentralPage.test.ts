import { signOutViaCentralPage } from '@/auth/utils/signOutViaCentralPage';
import { cookieStorage } from '~/utils/cookie-storage';

let mockEditorEnabled = false;
let mockAuthOrigin: string | undefined;
jest.mock('~/config', () => ({
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockEditorEnabled;
  },
  get REACT_APP_COMPANY_AUTH_ORIGIN() {
    return mockAuthOrigin;
  },
}));
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

it('uses the configured hosted auth origin rather than the registrable-domain fallback', async () => {
  mockEditorEnabled = true;
  mockAuthOrigin = 'https://auth.editor-a.example.test';
  try {
    const navigate = jest.fn();
    await signOutViaCentralPage(async () => undefined, navigate);
    expect(navigate).toHaveBeenCalledWith(
      'https://auth.editor-a.example.test/logout',
    );
  } finally {
    mockAuthOrigin = undefined;
    mockEditorEnabled = false;
  }
});
