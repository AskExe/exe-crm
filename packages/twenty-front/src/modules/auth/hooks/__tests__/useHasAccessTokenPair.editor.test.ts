import { act, renderHook, waitFor } from '@testing-library/react';
import { useHasAccessTokenPair } from '@/auth/hooks/useHasAccessTokenPair';
import {
  initializeCompanyEditorSession,
  revokeCompanyEditorSession,
} from '@/auth/company-editor/company-editor-session';

let mockReady = false;
let mockSigningOut = false;
const mockListeners = new Set<() => void>();
jest.mock('~/config', () => ({ REACT_APP_COMPANY_EDITOR_ENABLED: true }));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomState', () => ({
  useAtomState: () => [null, jest.fn()],
}));
jest.mock('@/auth/company-editor/company-editor-session', () => ({
  companyEditorSessionReady: () => mockReady,
  companyEditorSessionSigningOut: () => mockSigningOut,
  subscribeCompanyEditorSession: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
  initializeCompanyEditorSession: jest.fn(),
  revokeCompanyEditorSession: jest.fn(() => {
    mockReady = false;
  }),
}));

beforeEach(() => {
  mockReady = false;
  mockSigningOut = false;
  jest.clearAllMocks();
});
it('stays unauthenticated until the deferred current opaque proof actually completes', async () => {
  let complete!: () => void;
  jest.mocked(initializeCompanyEditorSession).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const { result } = renderHook(() => useHasAccessTokenPair());
  expect(result.current).toBe(false);
  await act(async () => {
    mockReady = true;
    for (const listener of mockListeners) listener();
    complete();
  });
  expect(result.current).toBe(true);
});
it.each(['denied', 'timeout'])(
  'stays unauthenticated and invalidates the editor after %s proof',
  async (failure) => {
    // jsdom cannot navigate; the real browser proof checks the fixed recovery URL.
    const navigationError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    jest
      .mocked(initializeCompanyEditorSession)
      .mockRejectedValueOnce(new Error(failure));
    try {
      const { result } = renderHook(() => useHasAccessTokenPair());
      await waitFor(() =>
        expect(revokeCompanyEditorSession).toHaveBeenCalledTimes(1),
      );
      expect(result.current).toBe(false);
      expect(navigationError).toHaveBeenCalled();
    } finally {
      navigationError.mockRestore();
    }
  },
);
it('does not rebound to sign-in when initialization fails during sign-out', async () => {
  mockSigningOut = true;
  const navigationError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => {});
  jest
    .mocked(initializeCompanyEditorSession)
    .mockRejectedValueOnce(new Error('revoked'));
  try {
    const { result } = renderHook(() => useHasAccessTokenPair());
    await waitFor(() =>
      expect(revokeCompanyEditorSession).toHaveBeenCalledTimes(1),
    );
    expect(result.current).toBe(false);
    expect(navigationError).not.toHaveBeenCalled();
  } finally {
    navigationError.mockRestore();
  }
});
