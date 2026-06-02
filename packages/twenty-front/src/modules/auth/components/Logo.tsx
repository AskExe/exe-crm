import { styled } from '@linaria/react';

const StyledBrandLogo = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  margin-top: 16px;
  user-select: none;
`;

const StyledExe = styled.span`
  color: #f5d76e;
  font-family: 'Epilogue', sans-serif;
  font-weight: 700;
  font-size: 30px;
  letter-spacing: 0.15em;
`;

const StyledProduct = styled.span`
  color: #e8e6f0;
  font-family: 'Epilogue', sans-serif;
  font-weight: 700;
  font-size: 30px;
  letter-spacing: 0.15em;
`;

type LogoProps = {
  primaryLogo?: string | null;
  secondaryLogo?: string | null;
  placeholder?: string | null;
  onClick?: () => void;
};

export const Logo = ({ onClick }: LogoProps) => {
  return (
    <StyledBrandLogo onClick={() => onClick?.()}>
      <StyledExe>EXE</StyledExe>
      <StyledProduct>&nbsp;CRM</StyledProduct>
    </StyledBrandLogo>
  );
};
