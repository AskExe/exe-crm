import { useEffect, useState } from 'react';
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
const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 320px;
  width: 100%;
`;
const StyledInput = styled.input`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  min-height: 44px;
  padding: 0 12px;
`;
const StyledError = styled.p`
  color: ${themeCssVariables.color.red};
  font-size: 13px;
`;

export const buildCentralAuthUrl = (product = 'CRM'): string => {
  const authHost = `auth.${getRegistrableDomain(window.location.hostname)}`;
  const callback = `${window.location.origin}/api/auth/gotrue-callback`;
  return `https://${authHost}/login?product=${encodeURIComponent(product)}&redirect=${encodeURIComponent(callback)}`;
};

export const CentralAuthRedirect = () => {
  const failure = getGoTrueBridgeFailure();
  const authUrl = buildCentralAuthUrl();
  const [workspaceName, setWorkspaceName] = useState('');
  const [setupError, setSetupError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (failure === null) window.location.replace(authUrl);
  }, [authUrl, failure]);

  const handleSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedWorkspaceName = workspaceName.trim();

    if (!trimmedWorkspaceName) return;

    setIsSubmitting(true);
    setSetupError('');

    try {
      const response = await fetch('/api/auth/gotrue-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceName: trimmedWorkspaceName }),
      });
      const result = await response.json();

      if (!response.ok || !result.redirectUrl) {
        throw new Error(
          result.error || 'Workspace setup could not be completed',
        );
      }

      window.location.assign(result.redirectUrl);
    } catch (error) {
      setSetupError(
        error instanceof Error
          ? error.message
          : 'Workspace setup could not be completed',
      );
      setIsSubmitting(false);
    }
  };

  return (
    <StyledContainer>
      <Logo />
      {failure === null ? (
        <>
          <StyledMessage>Taking you to Exe sign in…</StyledMessage>
          <Loader color="gray" />
        </>
      ) : failure === 'needs_setup' ? (
        <StyledForm onSubmit={handleSetup}>
          <StyledMessage>
            Name your workspace to finish CRM setup.
          </StyledMessage>
          <label htmlFor="workspace-name">Workspace name</label>
          <StyledInput
            id="workspace-name"
            name="workspaceName"
            autoComplete="organization"
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
          />
          {setupError && <StyledError role="alert">{setupError}</StyledError>}
          <StyledRetry
            type="submit"
            disabled={isSubmitting || !workspaceName.trim()}
          >
            {isSubmitting ? 'Creating workspace…' : 'Create workspace'}
          </StyledRetry>
        </StyledForm>
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
