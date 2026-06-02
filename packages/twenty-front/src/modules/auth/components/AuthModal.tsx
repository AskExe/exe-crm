import { AuthModalMountEffect } from '@/auth/components/AuthModalMountEffect';
import { styled } from '@linaria/react';
import React from 'react';

const StyledFullscreenContainer = styled.div`
  align-items: center;
  background-color: #0f0e1a;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100dvh;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
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
