import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { getGoTrueBridgeFailure } from '@/auth/utils/goTrueBridge';

const StyledNotice = styled.div`
  background: ${themeCssVariables.background.danger};
  border: 1px solid ${themeCssVariables.border.color.danger};
  border-radius: ${themeCssVariables.border.radius.md};
  box-sizing: border-box;
  color: ${themeCssVariables.font.color.primary};
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 24px;
  max-width: 360px;
  padding: 12px 16px;
  width: 100%;
`;

export const GoTrueSignInError = () => {
  const { t } = useLingui();
  const reason = getGoTrueBridgeFailure();

  if (reason === null) {
    return null;
  }

  // The query is untrusted. Show fixed guidance only, never its raw contents.
  let message;

  switch (reason) {
    case 'not_provisioned':
      message = t`Your CRM workspace access is not ready. Ask your administrator to set up your workspace or invite you. Signing in again will not complete workspace setup.`;
      break;
    case 'no_crm_access':
      message = t`Your account does not have access to this CRM workspace. Ask your administrator for a CRM invitation or access.`;
      break;
    case 'no_session':
    case 'session_expired':
    case 'invalid_session':
      message = t`Your Exe session is missing or has expired. Sign in again to continue to CRM.`;
      break;
    case 'token_unverifiable':
    case 'server_error':
      message = t`CRM could not complete sign-in. Please try again later. If this continues, contact your administrator.`;
      break;
    default:
      message = t`CRM could not complete sign-in. Try signing in again or contact your administrator for help.`;
  }

  return <StyledNotice role="alert">{message}</StyledNotice>;
};
