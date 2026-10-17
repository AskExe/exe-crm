import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let mockEditorEnabled = false;
let mockDemoWorkspaceId: string | null = null;
jest.mock('@/auth/utils/goTrueBridge', () => ({
  getDemoWorkspaceId: () => mockDemoWorkspaceId,
}));
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

it('uses the content fingerprint of the shipped public switcher', () => {
  const hash = createHash('sha256')
    .update(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../../../public/exe-service-switcher.js',
        ),
      ),
    )
    .digest('hex')
    .slice(0, 16);
  const wrapper = readFileSync(
    resolve(__dirname, '../ExeServiceSwitcher.tsx'),
    'utf8',
  );
  expect(wrapper).toContain(`/exe-service-switcher.js?v=${hash}`);
});

it('marks only public static warming as demo when the local routing hint exists', () => {
  mockDemoWorkspaceId = 'demo-workspace';
  try {
    const { container } = render(<ExeServiceSwitcher />);
    expect(container.querySelector('exe-service-switcher')).toHaveAttribute(
      'static-context',
      'demo',
    );
  } finally {
    mockDemoWorkspaceId = null;
  }
  const { container } = render(<ExeServiceSwitcher />);
  expect(container.querySelector('exe-service-switcher')).not.toHaveAttribute(
    'static-context',
  );
});
