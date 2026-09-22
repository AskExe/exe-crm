import { useEffect } from 'react';
import { styled } from '@linaria/react';
import { Loader } from 'twenty-ui/feedback';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { Logo } from '@/auth/components/Logo';
import { GoTrueSignInError } from '@/auth/components/GoTrueSignInError';
import { getRegistrableDomain } from '@/auth/utils/getRegistrableDomain';
import { getGoTrueBridgeFailure } from '@/auth/utils/goTrueBridge';

const StyledContainer = styled.main`
  align-items: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  padding: 40px 20px;
`;
const StyledMessage = styled.p`
  color: ${themeCssVariables.font.color.secondary};
  font-size: 14px;
  margin: 24px 0;
`;
const StyledRetry = styled.button`
  background: ${themeCssVariables.background.primary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  min-height: 44px;
  padding: 0 20px;
`;

export const buildCentralAuthUrl = (product = 'CRM'): string => {
  const authHost = `auth.${getRegistrableDomain(window.location.hostname)}`;
  const callback = `${window.location.origin}/api/auth/gotrue-callback`;
  return `https://${authHost}/login?product=${encodeURIComponent(product)}&redirect=${encodeURIComponent(callback)}`;
};

export const CentralAuthRedirect = () => {
  const failure = getGoTrueBridgeFailure();
  const authUrl = buildCentralAuthUrl();

  useEffect(() => {
    if (failure === null) window.location.replace(authUrl);
  }, [authUrl, failure]);

  return (
    <StyledContainer>
      <Logo />
      {failure === null ? (
        <>
          <StyledMessage>Taking you to Exe sign in…</StyledMessage>
          <Loader color="gray" />
        </>
      ) : (
        <>
          <GoTrueSignInError />
          <StyledRetry
            type="button"
            onClick={() => window.location.replace(authUrl)}
          >
            Try sign-in again
          </StyledRetry>
        </>
      )}
    </StyledContainer>
  );
};
