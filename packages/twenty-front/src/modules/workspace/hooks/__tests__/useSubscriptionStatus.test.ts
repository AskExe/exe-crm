import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { Provider as JotaiProvider } from 'jotai';

import { jotaiStore } from '@/ui/utilities/state/jotai/jotaiStore';
import { useSubscriptionStatus } from '@/workspace/hooks/useSubscriptionStatus';

/**
 * Billing is stripped from this fork.
 * useSubscriptionStatus is stubbed to always return undefined.
 * These tests verify the stub contract — not real billing behaviour.
 */

const Wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(JotaiProvider, { store: jotaiStore }, children);

describe('useSubscriptionStatus', () => {
  it('always returns undefined (billing stripped from this fork)', () => {
    const { result } = renderHook(() => useSubscriptionStatus(), {
      wrapper: Wrapper,
    });

    expect(result.current).toBeUndefined();
  });
});
