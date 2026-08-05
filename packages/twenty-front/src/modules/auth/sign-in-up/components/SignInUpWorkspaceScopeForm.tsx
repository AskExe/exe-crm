import { styled } from '@linaria/react';
import { useCallback, useState } from 'react';
import { exeFoundryBold } from 'twenty-ui/theme';

import { REACT_APP_ENABLE_ADMIN_TOKEN_LOGIN } from '~/config';

type AuthTab = 'credentials' | 'admin-token';

// Design tokens — Exe Foundry Bold
const TOKENS = {
  bgCard: exeFoundryBold.dark.background.tertiary,
  bgInput: exeFoundryBold.dark.authSurface.inputBackground,
  textPrimary: exeFoundryBold.dark.font.color.primary,
  textSecondary: exeFoundryBold.dark.font.color.secondary,
  accentGold: exeFoundryBold.dark.accent.primary,
  accentGoldHover: exeFoundryBold.dark.authSurface.buttonHover,
  borderInput: exeFoundryBold.dark.authSurface.inputBorder,
  error: exeFoundryBold.dark.authSurface.error,
  radiusSm: '6px',
  radiusMd: '8px',
} as const;

const StyledContentContainer = styled.div`
  margin-top: 0;
  min-width: 200px;
  width: 340px;
`;

// Tab toggle container
const StyledTabContainer = styled.div`
  background: ${TOKENS.bgCard};
  border-radius: ${TOKENS.radiusMd};
  box-sizing: border-box;
  display: flex;
  gap: 0;
  margin-bottom: 24px;
  padding: 4px;
  width: 100%;
`;

const StyledTab = styled.button<{ isActive: boolean }>`
  background: ${({ isActive }) => (isActive ? TOKENS.bgInput : 'transparent')};
  border: none;
  border-radius: ${TOKENS.radiusSm};
  color: ${({ isActive }) =>
    isActive ? TOKENS.textPrimary : TOKENS.textSecondary};
  cursor: pointer;
  flex: 1;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 400;
  min-height: 44px;
  padding: 10px 0;
  transition:
    background 0.15s,
    color 0.15s;

  &:hover {
    color: ${TOKENS.textPrimary};
  }
`;

// Admin token form styles
const StyledAdminTokenForm = styled.form`
  align-items: center;
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const StyledFieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
`;

const StyledLabel = styled.label`
  color: ${TOKENS.textSecondary};
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 400;
`;

const StyledInput = styled.input`
  background: ${TOKENS.bgInput};
  border: 1px solid ${TOKENS.borderInput};
  border-radius: ${TOKENS.radiusMd};
  box-sizing: border-box;
  color: ${TOKENS.textPrimary};
  font-family: 'Space Grotesk', monospace;
  font-size: 16px;
  height: 42px;
  outline: none;
  padding: 0 14px;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  width: 100%;

  &::placeholder {
    color: ${TOKENS.textSecondary};
    opacity: 0.5;
  }

  &:focus {
    border-color: ${TOKENS.accentGold};
    box-shadow: 0 0 0 2px ${exeFoundryBold.dark.authSurface.focusRing};
  }
`;

const StyledHelperText = styled.p`
  color: ${TOKENS.textSecondary};
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-style: italic;
  margin: 4px 0 0;
`;

const StyledGoldButton = styled.button`
  background: ${TOKENS.accentGold};
  border: none;
  border-radius: ${TOKENS.radiusMd};
  color: ${exeFoundryBold.dark.font.color.inverted};
  cursor: pointer;
  font-family: 'Epilogue', sans-serif;
  font-size: 16px;
  font-weight: 700;
  height: 42px;
  letter-spacing: 0.08em;
  margin-top: 24px;
  transition: background 0.15s;
  width: 100%;

  &:hover {
    background: ${TOKENS.accentGoldHover};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const StyledErrorMessage = styled.div`
  background: ${exeFoundryBold.dark.authSurface.errorBackground};
  border-radius: ${TOKENS.radiusSm};
  box-sizing: border-box;
  color: ${TOKENS.error};
  font-size: 13px;
  margin-top: 16px;
  padding: 8px 12px;
  width: 100%;
`;

const StyledForgotPassword = styled.button`
  background: none;
  border: none;
  color: ${TOKENS.textSecondary};
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  margin-top: 16px;
  padding: 0;
  text-align: center;
  transition: color 0.15s;
  width: 100%;

  &:hover {
    color: ${TOKENS.accentGold};
    text-decoration: underline;
  }
`;

const StyledSsoDivider = styled.div`
  align-items: center;
  display: flex;
  gap: 12px;
  margin-top: 24px;
  width: 100%;
`;

const StyledDividerLine = styled.div`
  background: ${exeFoundryBold.dark.authSurface.dividerLine};
  flex: 1;
  height: 1px;
`;

const StyledDividerText = styled.span`
  color: ${TOKENS.textSecondary};
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
`;

const StyledSsoLink = styled.a`
  align-items: center;
  border: 1px solid ${exeFoundryBold.dark.authSurface.dividerLine};
  border-radius: ${TOKENS.radiusMd};
  color: ${TOKENS.textPrimary};
  cursor: pointer;
  display: flex;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  height: 42px;
  justify-content: center;
  margin-top: 16px;
  text-decoration: none;
  transition:
    background 0.15s,
    border-color 0.15s;
  width: 100%;

  &:hover {
    background: ${exeFoundryBold.dark.authSurface.hoverOverlay};
    border-color: ${exeFoundryBold.dark.authSurface.hoverBorder};
  }
`;

const StyledSpinner = styled.div`
  animation: spin 0.6s linear infinite;
  border: 2px solid ${exeFoundryBold.dark.authSurface.spinnerTrack};
  border-radius: 50%;
  border-top-color: ${exeFoundryBold.dark.font.color.inverted};
  display: inline-block;
  height: 16px;
  width: 16px;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

export const SignInUpWorkspaceScopeForm = () => {
  const [activeTab, setActiveTab] = useState<AuthTab>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [credError, setCredError] = useState('');
  const [credLoading, setCredLoading] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminTokenError, setAdminTokenError] = useState('');
  const [adminTokenLoading, setAdminTokenLoading] = useState(false);
  // Setup wizard state
  const [showSetup, setShowSetup] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');

  const doLogin = useCallback(
    async (wsName?: string) => {
      setCredError('');
      setCredLoading(true);
      try {
        const payload: Record<string, string> = { email, password };

        if (wsName) {
          payload.workspaceName = wsName;
        }

        const res = await fetch('/api/auth/gotrue-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Authentication failed');
        }

        // First login — backend needs a workspace name
        if (data.needsSetup) {
          setShowSetup(true);
          setCredLoading(false);
          return;
        }

        if (data.redirectUrl) {
          // Option 3: redirect to Twenty's native /verify?loginToken=... flow
          window.location.href = data.redirectUrl;
        } else {
          throw new Error('No redirect URL received');
        }
      } catch (err) {
        setCredError(
          err instanceof Error ? err.message : 'Authentication failed',
        );
      } finally {
        setCredLoading(false);
      }
    },
    [email, password],
  );

  const handleCredentialsSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!email.trim() || !password.trim()) {
        setCredError('Email and password are required');
        return;
      }
      await doLogin();
    },
    [email, password, doLogin],
  );

  const handleSetupSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!workspaceName.trim()) {
        setCredError('Workspace name is required');
        return;
      }
      await doLogin(workspaceName.trim());
    },
    [workspaceName, doLogin],
  );

  const handleAdminTokenSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!adminToken.trim()) {
        setAdminTokenError('Admin token is required');
        return;
      }

      setAdminTokenError('');
      setAdminTokenLoading(true);

      try {
        const response = await fetch('/api/auth/admin-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: adminToken }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || data.error || 'Invalid admin token');
        }

        const data = await response.json();

        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
        } else {
          throw new Error('No redirect URL received from server');
        }
      } catch (err) {
        setAdminTokenError(
          err instanceof Error ? err.message : 'Authentication failed',
        );
      } finally {
        setAdminTokenLoading(false);
      }
    },
    [adminToken],
  );

  // Setup wizard — shown after first login when backend returns needsSetup
  if (showSetup) {
    return (
      <StyledContentContainer>
        <StyledAdminTokenForm onSubmit={handleSetupSubmit}>
          <StyledFieldGroup>
            <StyledLabel htmlFor="workspace-name">
              Name your workspace
            </StyledLabel>
            <StyledInput
              id="workspace-name"
              type="text"
              placeholder="My Company"
              value={workspaceName}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setWorkspaceName(e.target.value);
                if (credError) setCredError('');
              }}
              autoComplete="organization"
              autoFocus
            />
            <StyledHelperText>
              This workspace will be shared across CRM and Wiki.
            </StyledHelperText>
          </StyledFieldGroup>

          {credError && <StyledErrorMessage>{credError}</StyledErrorMessage>}

          <StyledGoldButton
            type="submit"
            disabled={credLoading || !workspaceName.trim()}
          >
            {credLoading ? <StyledSpinner /> : 'CREATE WORKSPACE'}
          </StyledGoldButton>
        </StyledAdminTokenForm>
      </StyledContentContainer>
    );
  }

  return (
    <StyledContentContainer>
      {/*
        bug a703f4e1 — the "Token" (Admin Token) tab is a static-secret
        owner-impersonation break-glass. Hidden unless a deployment explicitly
        opts in, so it is never demoed on the standard login page. When hidden,
        `activeTab` can only ever be 'credentials'.
      */}
      {REACT_APP_ENABLE_ADMIN_TOKEN_LOGIN && (
        <StyledTabContainer>
          <StyledTab
            type="button"
            isActive={activeTab === 'credentials'}
            onClick={() => setActiveTab('credentials')}
          >
            Login
          </StyledTab>
          <StyledTab
            type="button"
            isActive={activeTab === 'admin-token'}
            onClick={() => setActiveTab('admin-token')}
          >
            Token
          </StyledTab>
        </StyledTabContainer>
      )}

      {activeTab === 'credentials' && (
        <StyledAdminTokenForm onSubmit={handleCredentialsSubmit}>
          <StyledFieldGroup>
            <StyledLabel htmlFor="login-email">Email</StyledLabel>
            <StyledInput
              id="login-email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setEmail(e.target.value);
                if (credError) setCredError('');
              }}
              autoComplete="email"
            />
          </StyledFieldGroup>
          <StyledFieldGroup style={{ marginTop: 16 }}>
            <StyledLabel htmlFor="login-password">Password</StyledLabel>
            <StyledInput
              id="login-password"
              type="password"
              value={password}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setPassword(e.target.value);
                if (credError) setCredError('');
              }}
              autoComplete="current-password"
            />
          </StyledFieldGroup>

          {credError && <StyledErrorMessage>{credError}</StyledErrorMessage>}

          <StyledGoldButton
            type="submit"
            disabled={credLoading || !email.trim() || !password.trim()}
          >
            {credLoading ? <StyledSpinner /> : 'SIGN IN'}
          </StyledGoldButton>
        </StyledAdminTokenForm>
      )}

      {activeTab === 'admin-token' && (
        <StyledAdminTokenForm onSubmit={handleAdminTokenSubmit}>
          <StyledFieldGroup>
            <StyledLabel htmlFor="admin-token-input">Admin Token</StyledLabel>
            <StyledInput
              id="admin-token-input"
              type="password"
              placeholder="Paste your admin token"
              value={adminToken}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setAdminToken(e.target.value);
                if (adminTokenError) setAdminTokenError('');
              }}
              autoComplete="off"
            />
            <StyledHelperText>
              Found in your server&apos;s .env file
            </StyledHelperText>
          </StyledFieldGroup>

          {adminTokenError && (
            <StyledErrorMessage>{adminTokenError}</StyledErrorMessage>
          )}

          <StyledGoldButton
            type="submit"
            disabled={adminTokenLoading || !adminToken.trim()}
          >
            {adminTokenLoading ? <StyledSpinner /> : 'SIGN IN'}
          </StyledGoldButton>
        </StyledAdminTokenForm>
      )}

      <StyledSsoDivider>
        <StyledDividerLine />
        <StyledDividerText>or</StyledDividerText>
        <StyledDividerLine />
      </StyledSsoDivider>
      <StyledSsoLink
        href={`https://auth.askexe.com/login?product=CRM&redirect=${encodeURIComponent(
          window.location.origin + '/verify',
        )}`}
      >
        Sign in via Exe SSO
      </StyledSsoLink>
    </StyledContentContainer>
  );
};
