import { useLingui } from '@lingui/react/macro';
import { styled } from '@linaria/react';
import { IconMoon, IconSun } from 'twenty-ui/display';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useColorScheme } from '@/ui/theme/hooks/useColorScheme';

type NavigationDrawerThemeToggleProps = {
  isExpanded: boolean;
};

const StyledContainer = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.pill};
  bottom: ${themeCssVariables.spacing[3]};
  box-shadow: ${themeCssVariables.boxShadow.light};
  display: flex;
  justify-content: flex-start;
  left: ${themeCssVariables.spacing[2]};
  padding: ${themeCssVariables.spacing['0.5']};
  pointer-events: auto;
  position: absolute;
  right: ${themeCssVariables.spacing[2]};
  z-index: 8;
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
      ? themeCssVariables.accent.primary
      : themeCssVariables.background.transparent.lighter};
  border: 0;
  border-radius: ${themeCssVariables.border.radius.pill};
  box-shadow: ${({ isActive }) =>
    isActive ? themeCssVariables.boxShadow.light : 'none'};
  color: ${({ isActive }) =>
    isActive
      ? themeCssVariables.font.color.inverted
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
    background: ${({ isActive }) =>
      isActive
        ? themeCssVariables.accent.secondary
        : themeCssVariables.background.transparent.light};
    color: ${({ isActive }) =>
      isActive
        ? themeCssVariables.font.color.inverted
        : themeCssVariables.font.color.primary};
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
