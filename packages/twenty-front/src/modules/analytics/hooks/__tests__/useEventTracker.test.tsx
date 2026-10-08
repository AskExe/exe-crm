import { gql } from '@apollo/client';
import { type MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import {
  ANALYTICS_COOKIE_NAME,
  useEventTracker,
  setSessionId,
} from '@/analytics/hooks/useEventTracker';
import { AnalyticsType } from '~/generated-metadata/graphql';

let mockEditorEnabled = false;
jest.mock('~/config', () => ({
  ...jest.requireActual('~/config'),
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockEditorEnabled;
  },
}));

// Mock document.cookie
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: `${ANALYTICS_COOKIE_NAME}=exampleId`,
});

const mocks: MockedResponse[] = [
  {
    request: {
      query: gql`
        mutation TrackAnalytics(
          $type: AnalyticsType!
          $event: String
          $name: String
          $properties: JSON
        ) {
          trackAnalytics(
            type: $type
            event: $event
            name: $name
            properties: $properties
          ) {
            success
          }
        }
      `,
      variables: {
        type: AnalyticsType['TRACK'],
        event: 'Example Event',
        properties: {
          foo: 'bar',
        },
      },
    },
    result: jest.fn(() => ({
      data: {
        track: {
          success: true,
        },
      },
    })),
  },
  {
    request: {
      query: gql`
        mutation TrackAnalytics(
          $type: AnalyticsType!
          $event: String
          $name: String
          $properties: JSON
        ) {
          trackAnalytics(
            type: $type
            event: $event
            name: $name
            properties: $properties
          ) {
            success
          }
        }
      `,
      variables: {
        type: AnalyticsType['PAGEVIEW'],
        name: 'Example',
        properties: {
          sessionId: 'exampleId',
          pathname: '/example/path',
          userAgent: '',
          timeZone: '',
          locale: '',
          href: '',
          referrer: '',
        },
      },
    },
    result: jest.fn(() => ({
      data: {
        track: {
          success: true,
        },
      },
    })),
  },
];

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={mocks}>{children}</MockedProvider>
);

describe('useEventTracker', () => {
  afterEach(() => {
    mockEditorEnabled = false;
  });
  it('leaves the hosted session cookie and native analytics authority untouched', async () => {
    mockEditorEnabled = true;
    document.cookie = '__Host-exe_crm_session=owned-opaque-cookie';
    const originalCookie = document.cookie;
    const originalCalls = (mocks[0].result as jest.Mock).mock.calls.length;
    const { result } = renderHook(() => useEventTracker(), {
      wrapper: Wrapper,
    });
    act(() => {
      setSessionId();
      result.current(AnalyticsType['TRACK'], {
        event: 'Example Event',
        properties: { foo: 'bar' },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.cookie).toBe(originalCookie);
    expect(mocks[0].result).toHaveBeenCalledTimes(originalCalls);
    document.cookie = `${ANALYTICS_COOKIE_NAME}=exampleId`;
  });
  it('should make the call to track the event', async () => {
    const payload = {
      event: 'Example Event',
      properties: {
        foo: 'bar',
      },
    };

    const { result } = renderHook(() => useEventTracker(), {
      wrapper: Wrapper,
    });
    act(() => {
      result.current(AnalyticsType['TRACK'], payload);
    });
    await waitFor(() => {
      expect(mocks[0].result).toHaveBeenCalled();
    });
  });

  it('should make the call to track a pageview', async () => {
    const payload = {
      name: 'Example',
      properties: {
        sessionId: 'exampleId',
        pathname: '/example/path',
        userAgent: '',
        timeZone: '',
        locale: '',
        href: '',
        referrer: '',
      },
    };
    const { result } = renderHook(() => useEventTracker(), {
      wrapper: Wrapper,
    });
    act(() => {
      result.current(AnalyticsType['PAGEVIEW'], payload);
    });
    await waitFor(() => {
      expect(mocks[1].result).toHaveBeenCalled();
    });
  });
});
