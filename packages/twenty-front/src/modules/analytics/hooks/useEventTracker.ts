import { useCallback } from 'react';
import { v4 } from 'uuid';
import { REACT_APP_COMPANY_EDITOR_ENABLED } from '~/config';
import { useMutation } from '@apollo/client/react';
import {
  AnalyticsType,
  type MutationTrackAnalyticsArgs,
  TrackAnalyticsDocument,
} from '~/generated-metadata/graphql';

export const ANALYTICS_COOKIE_NAME = 'analyticsCookie';
export const getSessionId = (): string => {
  const cookie: { [key: string]: string } = {};
  document.cookie.split(';').forEach((el) => {
    const [key, value] = el.split('=');
    cookie[key.trim()] = value;
  });
  return cookie[ANALYTICS_COOKIE_NAME];
};

export const setSessionId = (domain?: string): void => {
  if (REACT_APP_COMPANY_EDITOR_ENABLED) return;
  const sessionId = getSessionId() || v4();
  const baseCookie = `${ANALYTICS_COOKIE_NAME}=${sessionId}; Max-Age=1800; path=/; secure`;
  const cookie = domain ? baseCookie + `; domain=${domain}` : baseCookie;

  document.cookie = cookie;
};

export const useEventTracker = () => {
  const [createEventMutation] = useMutation(TrackAnalyticsDocument);

  return useCallback(
    (
      type: AnalyticsType,
      payload: Omit<MutationTrackAnalyticsArgs, 'type'>,
    ) => {
      // Hosted editor authority does not include native analytics mutations.
      if (REACT_APP_COMPANY_EDITOR_ENABLED) return;
      createEventMutation({
        variables: {
          type,
          ...payload,
          properties: {
            ...payload.properties,
            ...(type === AnalyticsType['PAGEVIEW']
              ? { sessionId: getSessionId() }
              : {}),
          },
        },
      });
    },
    [createEventMutation],
  );
};
