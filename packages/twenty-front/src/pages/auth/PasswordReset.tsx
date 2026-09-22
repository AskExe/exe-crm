import { CentralAuthRedirect } from '@/auth/components/CentralAuthRedirect';

// A CRM reset URL can contain a CRM-specific token. Never copy it to another
// origin: Auth owns password recovery and starts its own verified flow there.
export const PasswordReset = () => <CentralAuthRedirect />;
