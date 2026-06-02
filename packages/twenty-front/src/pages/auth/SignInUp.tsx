import { useSignInUp } from '@/auth/sign-in-up/hooks/useSignInUp';
import { useSignInUpForm } from '@/auth/sign-in-up/hooks/useSignInUpForm';
import {
  SignInUpStep,
  signInUpStepState,
} from '@/auth/states/signInUpStepState';
import { workspacePublicDataState } from '@/auth/states/workspacePublicDataState';
import { styled } from '@linaria/react';

import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

import { Logo } from '@/auth/components/Logo';
// EmailVerificationSent REMOVED — GoTrue owns email verification.
// SignInUpGlobalScopeForm REMOVED — not rendered (we always show workspace scope form).
import { SignInUpWorkspaceScopeForm } from '@/auth/sign-in-up/components/SignInUpWorkspaceScopeForm';
import { isMultiWorkspaceEnabledState } from '@/client-config/states/isMultiWorkspaceEnabledState';
import { useIsCurrentLocationOnAWorkspace } from '@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace';
import { useIsCurrentLocationOnDefaultDomain } from '@/domain-manager/hooks/useIsCurrentLocationOnDefaultDomain';
import { useMemo } from 'react';

import { clientConfigApiStatusState } from '@/client-config/states/clientConfigApiStatusState';
import { Loader } from 'twenty-ui/feedback';
import { AnimatedEaseIn } from 'twenty-ui/utilities';

// oxlint-disable-next-line exe-crm/no-hardcoded-colors
const StyledPageContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  padding: 40px 20px;
  width: 100%;
`;

const StyledSubtitle = styled.p`
  color: #a09caf;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 400;
  margin: 0 0 32px;
  text-align: center;
`;

const StyledLoaderContainer = styled.div`
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 32px 0;
  width: 100%;
`;

export const SignInUp = () => {
  const setSignInUpStep = useSetAtomState(signInUpStepState);
  const clientConfigApiStatus = useAtomStateValue(clientConfigApiStatusState);

  const { form } = useSignInUpForm();
  const { signInUpStep } = useSignInUp(form);
  const { isDefaultDomain } = useIsCurrentLocationOnDefaultDomain();
  const { isOnAWorkspace } = useIsCurrentLocationOnAWorkspace();
  const workspacePublicData = useAtomStateValue(workspacePublicDataState);
  const isMultiWorkspaceEnabled = useAtomStateValue(
    isMultiWorkspaceEnabledState,
  );

  const onClickOnLogo = () => {
    setSignInUpStep(SignInUpStep.Init);
  };

  const signInUpForm = useMemo(() => {
    if (!clientConfigApiStatus.isLoadedOnce) {
      return (
        <StyledLoaderContainer>
          <Loader color="gray" />
        </StyledLoaderContainer>
      );
    }

    // Always show the unified Login/Token form
    return <SignInUpWorkspaceScopeForm />;
  }, [
    clientConfigApiStatus.isLoadedOnce,
    isDefaultDomain,
    isMultiWorkspaceEnabled,
    isOnAWorkspace,
    signInUpStep,
    workspacePublicData,
  ]);

  // Email verification step REMOVED — GoTrue owns email verification.

  return (
    <StyledPageContainer>
      <AnimatedEaseIn>
        <Logo
          secondaryLogo={workspacePublicData?.logo}
          placeholder={workspacePublicData?.displayName}
          onClick={onClickOnLogo}
        />
      </AnimatedEaseIn>
      <StyledSubtitle>Sign in to your workspace</StyledSubtitle>
      {signInUpForm}
    </StyledPageContainer>
  );
};
