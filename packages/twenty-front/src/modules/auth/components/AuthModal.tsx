import { AuthModalMountEffect } from '@/auth/components/AuthModalMountEffect';
import { styled } from '@linaria/react';
import React from 'react';

// oxlint-disable-next-line exe-crm/no-hardcoded-colors
const StyledFullscreenContainer = styled.div`
  align-items: center;
  background-color: #0f0e1a;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  left: 0;
  min-height: 100dvh;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 1000;
`;

type AuthModalProps = {
  children: React.ReactNode;
};

export const AuthModal = ({ children }: AuthModalProps) => {
  return (
    <>
      <AuthModalMountEffect />
      <StyledFullscreenContainer>{children}</StyledFullscreenContainer>
    </>
  );
};
