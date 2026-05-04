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
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.pill};
  z-index: 8;
  background: ${themeCssVariables.background.quaternary};
  box-shadow: ${themeCssVariables.boxShadow.light};
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
    isActive
      ? themeCssVariables.background.primary
      : themeCssVariables.background.transparent.lighter};
  border: 0;
  border-radius: ${themeCssVariables.border.radius.pill};
  box-shadow: ${({ isActive }) =>
    isActive ? themeCssVariables.boxShadow.light : 'none'};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.primary
      : themeCssVariables.font.color.secondary};
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
    background: ${themeCssVariables.background.primary};
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
