import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';
import {
  initializeCompanyEditorSession,
  companyEditorSessionReady,
  subscribeCompanyEditorSession,
} from '@/auth/company-editor/company-editor-session';
import { SignOutOnOtherTabSignOutEffect } from '@/auth/effect-components/SignOutOnOtherTabSignOutEffect';
import type * as Undici from 'undici';

let mockEditorEnabled = false;
jest.mock('~/config', () => ({
  ...jest.requireActual('~/config'),
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockEditorEnabled;
  },
}));
import { useAuth } from '@/auth/hooks/useAuth';
import { billingState } from '@/client-config/states/billingState';
import { isDeveloperDefaultSignInPrefilledState } from '@/client-config/states/isDeveloperDefaultSignInPrefilledState';
import { supportChatState } from '@/client-config/states/supportChatState';

import { workspaceAuthProvidersState } from '@/workspace/states/workspaceAuthProvidersState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useApolloClient } from '@apollo/client/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { type ReactNode, act } from 'react';
import { MemoryRouter } from 'react-router-dom';

import {
  email,
  mocks,
  password,
  results,
  token,
} from '@/auth/hooks/__mocks__/useAuth';
import { isMultiWorkspaceEnabledState } from '@/client-config/states/isMultiWorkspaceEnabledState';
import { SnackBarComponentInstanceContext } from '@/ui/feedback/snack-bar-manager/contexts/SnackBarComponentInstanceContext';
import { render, renderHook } from '@testing-library/react';
import { SupportDriver } from '~/generated-metadata/graphql';

const mockCentralNavigation = jest.fn();
jest.mock('@/auth/utils/signOutViaCentralPage', () => {
  const original = jest.requireActual('@/auth/utils/signOutViaCentralPage');
  return {
    signOutViaCentralPage: (signOut: () => Promise<void>) =>
      original.signOutViaCentralPage(signOut, mockCentralNavigation),
  };
});
const redirectSpy = jest.fn();

jest.mock('@/domain-manager/hooks/useRedirect', () => ({
  useRedirect: jest.fn().mockImplementation(() => ({
    redirect: redirectSpy,
  })),
}));

jest.mock('@/domain-manager/hooks/useOrigin', () => ({
  useOrigin: jest.fn().mockImplementation(() => ({
    origin: 'http://localhost',
  })),
}));

jest.mock('@/captcha/hooks/useRequestFreshCaptchaToken', () => ({
  useRequestFreshCaptchaToken: jest.fn().mockImplementation(() => ({
    requestFreshCaptchaToken: jest.fn(),
  })),
}));

jest.mock('@/auth/sign-in-up/hooks/useSignUpInNewWorkspace', () => ({
  useSignUpInNewWorkspace: jest.fn().mockImplementation(() => ({
    createWorkspace: jest.fn(),
  })),
}));

jest.mock('@/domain-manager/hooks/useRedirectToWorkspaceDomain', () => ({
  useRedirectToWorkspaceDomain: jest.fn().mockImplementation(() => ({
    redirectToWorkspaceDomain: jest.fn(),
  })),
}));

jest.mock('@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace', () => ({
  useIsCurrentLocationOnAWorkspace: jest.fn().mockImplementation(() => ({
    isOnAWorkspace: true,
  })),
}));

jest.mock('@/domain-manager/hooks/useLastAuthenticatedWorkspaceDomain', () => ({
  useLastAuthenticatedWorkspaceDomain: jest.fn().mockImplementation(() => ({
    setLastAuthenticateWorkspaceDomain: jest.fn(),
  })),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={Object.values(mocks)}>
    <MemoryRouter>
      <SnackBarComponentInstanceContext.Provider
        value={{ instanceId: 'test-instance-id' }}
      >
        {children}
      </SnackBarComponentInstanceContext.Provider>
    </MemoryRouter>
  </MockedProvider>
);

const renderHooks = () => {
  const { result } = renderHook(
    () => {
      return useAuth();
    },
    {
      wrapper: Wrapper,
    },
  );
  return { result };
};

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEditorEnabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // 'fetch' is absent from the jsdom global; delete the stub spies replaced
    delete (global as { fetch?: unknown }).fetch;
  });

  it('should return login token object', async () => {
    const { result } = renderHooks();

    await act(async () => {
      expect(
        await result.current.getLoginTokenFromCredentials(email, password),
      ).toStrictEqual(results.getLoginTokenFromCredentials);
    });

    expect(mocks.getLoginTokenFromCredentials.result).toHaveBeenCalled();
  });

  it('should verify user', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.getAuthTokensFromLoginToken(token);
    });

    expect(mocks.getAuthTokensFromLoginToken.result).toHaveBeenCalled();
    expect(mocks.getCurrentUser.result).toHaveBeenCalled();
  });

  it('should handle credential sign-in', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signInWithCredentialsInWorkspace(email, password);
    });

    expect(mocks.getLoginTokenFromCredentials.result).toHaveBeenCalled();
    expect(mocks.getAuthTokensFromLoginToken.result).toHaveBeenCalled();
  });

  it('should handle google sign-in', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signInWithGoogle({
        workspaceInviteHash: 'workspaceInviteHash',
        action: 'join-workspace',
      });
    });

    expect(redirectSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/auth/google?workspaceInviteHash=workspaceInviteHash',
      ),
    );
  });

  it('should handle sign-out', async () => {
    const { result } = renderHook(
      () => {
        const client = useApolloClient();
        const workspaceAuthProviders = useAtomStateValue(
          workspaceAuthProvidersState,
        );
        const billing = useAtomStateValue(billingState);
        const isDeveloperDefaultSignInPrefilled = useAtomStateValue(
          isDeveloperDefaultSignInPrefilledState,
        );
        const supportChat = useAtomStateValue(supportChatState);
        const isMultiWorkspaceEnabled = useAtomStateValue(
          isMultiWorkspaceEnabledState,
        );
        return {
          ...useAuth(),
          client,
          state: {
            workspaceAuthProviders,
            billing,
            isDeveloperDefaultSignInPrefilled,
            supportChat,
            isMultiWorkspaceEnabled,
          },
        };
      },
      {
        wrapper: Wrapper,
      },
    );

    const { signOut, client } = result.current;

    // jsdom does not provide fetch, so install a stub before spying on it
    if (typeof global.fetch !== 'function') {
      global.fetch = () => Promise.reject(new Error('fetch not available'));
    }
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ status: 204 } as Response);

    await act(async () => {
      await signOut();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/auth\..*\/auth\/logout$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );

    expect(sessionStorage.length).toBe(0);
    expect(client.cache.extract()).toEqual({});

    const { state } = result.current;

    expect(state.workspaceAuthProviders).toEqual(null);
    expect(state.billing).toBeNull();
    expect(state.isDeveloperDefaultSignInPrefilled).toBe(false);
    expect(state.supportChat).toEqual({
      supportDriver: SupportDriver.NONE,
      supportFrontChatId: null,
    });
  });

  it('should handle credential sign-up', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signUpWithCredentialsInWorkspace({
        email,
        password,
      });
    });

    expect(mocks.signUpInWorkspace.result).toHaveBeenCalled();
  });
});

describe('company editor UI sign-out boundary', () => {
  let fetchMock: jest.Mock;
  let channel: { onmessage: ((event: MessageEvent) => void) | null };
  beforeAll(() => {
    Object.defineProperty(globalThis, 'TextDecoder', {
      value: TextDecoder,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'TextEncoder', {
      value: TextEncoder,
      configurable: true,
    });
    const { Headers } = require('undici') as typeof Undici;
    Object.defineProperty(globalThis, 'Headers', {
      value: Headers,
      configurable: true,
    });
    Object.defineProperty(AbortSignal, 'timeout', {
      value: () => new AbortController().signal,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      value: class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        constructor() {
          channel = this;
        }
        postMessage() {}
      },
      configurable: true,
    });
  });
  beforeEach(() => {
    mockEditorEnabled = true;
    fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
    });
  });
  afterEach(() => {
    mockEditorEnabled = false;
  });
  const jsonResponse = (value: object) =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));
          controller.close();
        },
      }),
    }) as unknown as Response;
  it('invalidates immediately and recovers unconfirmed child revocation through real central logout', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        context: 'a'.repeat(64),
        csrf: 'a'.repeat(43) + '.1999999999.' + 'b'.repeat(43),
      }),
    );
    await initializeCompanyEditorSession();
    expect(companyEditorSessionReady()).toBe(true);
    let rejectLogout!: (error: Error) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectLogout = reject;
        }),
    );
    const { result } = renderHooks();
    let signOut!: Promise<void>;
    act(() => {
      signOut = result.current.signOut();
    });
    expect(companyEditorSessionReady()).toBe(false);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/company-session/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    await act(async () => {
      rejectLogout(new Error('Core unavailable'));
      await expect(signOut).resolves.toBeUndefined();
      expect(mockCentralNavigation).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/auth\..*\/logout$/),
      );
    });
  });
  it('cross-tab sign-out invokes real clearSession and keeps the editor terminal', async () => {
    const invalidated = jest.fn();
    const unsubscribe = subscribeCompanyEditorSession(invalidated);
    render(
      <Wrapper>
        <SignOutOnOtherTabSignOutEffect />
      </Wrapper>,
    );
    await act(async () => {
      channel.onmessage?.({ data: { type: 'sign-out' } } as MessageEvent);
    });
    expect(companyEditorSessionReady()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invalidated).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
