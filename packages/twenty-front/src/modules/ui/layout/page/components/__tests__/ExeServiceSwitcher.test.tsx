let mockEditorEnabled = false;
jest.mock('~/config', () => ({
  ...jest.requireActual('~/config'),
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockEditorEnabled;
  },
}));
import { act, render } from '@testing-library/react';

import { ExeServiceSwitcher } from '@/ui/layout/page/components/ExeServiceSwitcher';
import { signOutViaCentralPage } from '@/auth/utils/signOutViaCentralPage';

const signOut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/auth/hooks/useAuth', () => ({ useAuth: () => ({ signOut }) }));
jest.mock('@/auth/states/currentUserState', () => ({ currentUserState: {} }));
jest.mock('@/ui/layout/hooks/useShowAuthModal', () => ({
  useShowAuthModal: () => false,
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => ({ email: 'member@example.test' }),
}));
jest.mock('@/auth/utils/signOutViaCentralPage', () => ({
  signOutViaCentralPage: jest.fn().mockResolvedValue(undefined),
}));

it('cancels direct navigation and delegates switcher logout to native CRM cleanup', () => {
  const { container } = render(<ExeServiceSwitcher />);
  const element = container.querySelector('exe-service-switcher')!;
  const event = new CustomEvent('exe-logout', {
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(signOutViaCentralPage).toHaveBeenCalledWith(signOut);
  act(() => {
    element.dispatchEvent(new CustomEvent('exe-logout', { cancelable: true }));
  });
  expect(signOutViaCentralPage).toHaveBeenCalledTimes(1);
});

it('uses the editor hook central logout exactly once instead of wrapping it twice', () => {
  jest.clearAllMocks();
  mockEditorEnabled = true;
  try {
    const { container } = render(<ExeServiceSwitcher />);
    const element = container.querySelector('exe-service-switcher')!;
    act(() => {
      element.dispatchEvent(
        new CustomEvent('exe-logout', { cancelable: true }),
      );
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOutViaCentralPage).not.toHaveBeenCalled();
  } finally {
    mockEditorEnabled = false;
  }
});
