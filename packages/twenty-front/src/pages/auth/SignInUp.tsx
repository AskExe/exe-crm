import { CentralAuthRedirect } from '@/auth/components/CentralAuthRedirect';
import { SignInUpWorkspaceScopeForm } from '@/auth/sign-in-up/components/SignInUpWorkspaceScopeForm';
import { isGoTrueDemoJoinIntent } from '@/auth/utils/goTrueBridge';

export const SignInUp = () =>
  isGoTrueDemoJoinIntent(window.location) ? (
    <SignInUpWorkspaceScopeForm />
  ) : (
    <CentralAuthRedirect />
  );
