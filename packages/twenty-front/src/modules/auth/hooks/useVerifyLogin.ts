import { useAuth } from '@/auth/hooks/useAuth';
import {
  clearDemoWorkspaceSession,
  markDemoWorkspaceSession,
} from '@/auth/utils/goTrueBridge';
import { clearSessionLocalStorageKeys } from '@/auth/utils/clearSessionLocalStorageKeys';
import { replaceWorkspaceDocument } from '@/auth/utils/replaceWorkspaceDocument';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useLingui } from '@lingui/react/macro';
import { AppPath } from 'twenty-shared/types';
import { useNavigateApp } from '~/hooks/useNavigateApp';

export const useVerifyLogin = () => {
  const { enqueueErrorSnackBar } = useSnackBar();
  const navigate = useNavigateApp();
  const { getAuthTokensFromLoginToken } = useAuth();
  const { t } = useLingui();

  const verifyLoginToken = async (loginToken: string, isDemoLogin = false) => {
    try {
      const workspaceId = await getAuthTokensFromLoginToken(loginToken);

      // MFA may need another step before a workspace is authenticated.
      if (!workspaceId) {
        return;
      }

      // Set this on the workspace origin only after a successful exchange.
      // It is a routing hint; the server still verifies every DEMO join.
      if (isDemoLogin && workspaceId) {
        markDemoWorkspaceSession(workspaceId);
      } else {
        clearDemoWorkspaceSession();
      }
      // Workspace metadata, cached records and view IDs belong to the previous
      // native session. Start a clean document only after the exchange succeeds.
      clearSessionLocalStorageKeys();
      replaceWorkspaceDocument();
    } catch {
      enqueueErrorSnackBar({
        message: t`Authentication failed`,
      });
      navigate(AppPath.SignInUp);
    }
  };

  return { verifyLoginToken };
};
