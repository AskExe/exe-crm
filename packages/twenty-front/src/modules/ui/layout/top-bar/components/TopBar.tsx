import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

type TopBarProps = {
  className?: string;
  leftComponent?: ReactNode;
  rightComponent?: ReactNode;
  bottomComponent?: ReactNode;
  displayBottomBorder?: boolean;
};

const StyledContainer = styled.div`
  --t-background-primary: #1a1832;
  --t-background-secondary: #15142a;
  --t-background-tertiary: #221f3e;
  --t-background-quaternary: #221f3e;
  --t-background-transparent-light: rgba(240, 237, 232, 0.08);
  --t-background-transparent-lighter: rgba(240, 237, 232, 0.04);
  --t-border-color-medium: rgba(240, 237, 232, 0.12);
  --t-border-color-light: rgba(240, 237, 232, 0.08);
  --t-font-color-primary: #f0ede8;
  --t-font-color-secondary: #d3d0da;
  --t-font-color-tertiary: #a09caf;
  --t-font-color-light: #6f6a80;

  background:
    radial-gradient(
      520px 160px at 12% 0%,
      rgba(245, 215, 110, 0.14),
      rgba(15, 14, 26, 0) 62%
    ),
    #0f0e1a;
  border-bottom: 1px solid rgba(240, 237, 232, 0.08);
  color: #f0ede8;
  display: flex;
  flex-direction: column;

  margin-left: 0;
`;

const StyledTopBar = styled.div`
  align-items: center;

  box-sizing: border-box;
  color: ${themeCssVariables.font.color.secondary};
  display: flex;
  flex-direction: row;
  font-weight: ${themeCssVariables.font.weight.medium};
  height: 39px;
  justify-content: space-between;
  padding-right: ${themeCssVariables.spacing[2]};

  z-index: 7;
`;

const StyledLeftSection = styled.div`
  display: flex;
`;

const StyledRightSection = styled.div`
  display: flex;
  font-weight: ${themeCssVariables.font.weight.regular};
  gap: ${themeCssVariables.betweenSiblingsGap};
`;

export const TopBar = ({
  className,
  leftComponent,
  rightComponent,
  bottomComponent,
}: TopBarProps) => (
  <StyledContainer className={className}>
    <StyledTopBar>
      <StyledLeftSection>{leftComponent}</StyledLeftSection>
      <StyledRightSection>{rightComponent}</StyledRightSection>
    </StyledTopBar>
    {bottomComponent}
  </StyledContainer>
);
