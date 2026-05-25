import { useRef } from 'react';

export const useIsHeadlessEngineCommandEffectInitialized = () => {
  // oxlint-disable-next-line exe-crm/no-state-useref
  const isInitializedRef = useRef(false);

  const setIsInitialized = (value: boolean) => {
    isInitializedRef.current = value;
  };

  return { isInitializedRef, setIsInitialized };
};
