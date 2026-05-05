import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { IconMoon, IconSun } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useColorScheme } from '@/ui/theme/hooks/useColorScheme';

type NavigationDrawerThemeToggleProps = {
  isExpanded: boolean;
};

const StyledContainer = styled.div`
  position: absolute;
  bottom: ${themeCssVariables.spacing[3]};
  display: flex;
  left: ${themeCssVariables.spacing[2]};
  right: ${themeCssVariables.spacing[2]};
  justify-content: flex-start;
  align-items: center;
  border: 1px solid rgba(240, 237, 232, 0.12);
  border-radius: ${themeCssVariables.border.radius.pill};
  z-index: 8;
  background: rgba(26, 24, 50, 0.92);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
  padding: ${themeCssVariables.spacing['0.5']};
  pointer-events: auto;
`;

const StyledToggleButtonGroup = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing['0.5']};
  width: 100%;
`;

const StyledThemeButton = styled.button<{ isActive: boolean }>`
  align-items: center;
  background: ${({ isActive }) =>
    isActive ? '#f5d76e' : 'rgba(240, 237, 232, 0.04)'};
  border: 0;
  border-radius: ${themeCssVariables.border.radius.pill};
  box-shadow: ${({ isActive }) =>
    isActive ? '0 4px 12px rgba(245, 215, 110, 0.16)' : 'none'};
  color: ${({ isActive }) => (isActive ? '#0f0e1a' : '#d3d0da')};
  cursor: pointer;
  display: flex;
  flex: 1 1 0;
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  gap: ${themeCssVariables.spacing[1]};
  height: ${themeCssVariables.spacing[7]};
  justify-content: center;
  min-width: 0;
  padding: 0 ${themeCssVariables.spacing[2]};
  transition: ${themeCssVariables.clickableElementBackgroundTransition};

  &:hover {
    background: ${({ isActive }) =>
      isActive ? '#fadf85' : 'rgba(240, 237, 232, 0.08)'};
    color: ${({ isActive }) => (isActive ? '#0f0e1a' : '#f0ede8')};
  }
`;

export const NavigationDrawerThemeToggle = ({
  isExpanded,
}: NavigationDrawerThemeToggleProps) => {
  const { t } = useLingui();
  const { colorScheme, setColorScheme } = useColorScheme();

  const isDark = colorScheme === 'Dark';

  if (isExpanded) {
    return (
      <StyledContainer>
        <StyledToggleButtonGroup>
          <StyledThemeButton
            aria-label={t`Set Light theme`}
            aria-pressed={!isDark}
            isActive={!isDark}
            onClick={() => setColorScheme('Light')}
            title={t`Light`}
            type="button"
          >
            <IconSun size={14} />
            {t`Light`}
          </StyledThemeButton>
          <StyledThemeButton
            aria-label={t`Set Dark theme`}
            aria-pressed={isDark}
            isActive={isDark}
            onClick={() => setColorScheme('Dark')}
            title={t`Dark`}
            type="button"
          >
            <IconMoon size={14} />
            {t`Dark`}
          </StyledThemeButton>
        </StyledToggleButtonGroup>
      </StyledContainer>
    );
  }

  return (
    <StyledContainer>
      <StyledToggleButtonGroup>
        <StyledThemeButton
          aria-label={t`Set Light theme`}
          aria-pressed={!isDark}
          isActive={!isDark}
          onClick={() => setColorScheme('Light')}
          title={t`Light`}
          type="button"
        >
          <IconSun size={14} />
        </StyledThemeButton>
        <StyledThemeButton
          aria-label={t`Set Dark theme`}
          aria-pressed={isDark}
          isActive={isDark}
          onClick={() => setColorScheme('Dark')}
          title={t`Dark`}
          type="button"
        >
          <IconMoon size={14} />
        </StyledThemeButton>
      </StyledToggleButtonGroup>
    </StyledContainer>
  );
};
