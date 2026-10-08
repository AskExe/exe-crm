import { useEffect, useSyncExternalStore } from 'react';
import { REACT_APP_COMPANY_EDITOR_ENABLED } from '~/config';
import {
  companyEditorSessionReady,
  companyEditorSessionSigningOut,
  initializeCompanyEditorSession,
  revokeCompanyEditorSession,
  subscribeCompanyEditorSession,
} from '@/auth/company-editor/company-editor-session';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';

export const useHasAccessTokenPair = (): boolean => {
  const [tokenPair] = useAtomState(tokenPairState);
  const editorReady = useSyncExternalStore(
    subscribeCompanyEditorSession,
    companyEditorSessionReady,
  );
  useEffect(() => {
    if (REACT_APP_COMPANY_EDITOR_ENABLED) {
      initializeCompanyEditorSession().catch(() => {
        revokeCompanyEditorSession();
        if (!companyEditorSessionSigningOut())
          window.location.replace('/company-session/start');
      });
    }
  }, []);
  return REACT_APP_COMPANY_EDITOR_ENABLED ? editorReady : !!tokenPair;
};
