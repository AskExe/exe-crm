import { useLingui } from '@lingui/react/macro';
import { IconMoon, IconSun } from 'twenty-ui/display';
import { LightIconButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { styled } from '@linaria/react';

import { useColorScheme } from '@/ui/theme/hooks/useColorScheme';

type NavigationDrawerThemeToggleProps = {
  isExpanded: boolean;
};

const StyledContainer = styled.div`
  position: absolute;
  bottom: ${themeCssVariables.spacing[2]};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  left: ${themeCssVariables.spacing[1]};
  right: ${themeCssVariables.spacing[1]};
  justify-content: flex-start;
  align-items: center;
  border-radius: ${themeCssVariables.border.radius.md};
  z-index: 2;
  background: ${themeCssVariables.background.secondary};
  padding: ${themeCssVariables.spacing[1]};
  pointer-events: auto;
`;

const StyledToggleButtonGroup = styled.div`
  display: inline-flex;
  gap: ${themeCssVariables.spacing[1]};
`;


export const NavigationDrawerThemeToggle = ({
  isExpanded,
}: NavigationDrawerThemeToggleProps) => {
  const { t } = useLingui();
  const { colorScheme, setColorScheme } = useColorScheme();

  const isDark = colorScheme === 'Dark';

  const handleCycleTheme = () => {
    setColorScheme(isDark ? 'Light' : 'Dark');
  };

  if (isExpanded) {
    return (
      <StyledContainer>
        <StyledToggleButtonGroup>
          <LightIconButton
            Icon={IconSun}
            aria-label={t`Set Light theme`}
            accent="tertiary"
            onClick={() => setColorScheme('Light')}
            active={!isDark}
            title={t`Light`}
          />
          <LightIconButton
            Icon={IconMoon}
            aria-label={t`Set Dark theme`}
            accent="tertiary"
            onClick={() => setColorScheme('Dark')}
            active={isDark}
            title={t`Dark`}
          />
        </StyledToggleButtonGroup>
      </StyledContainer>
    );
  }

  return (
    <StyledContainer>
      <LightIconButton
        Icon={isDark ? IconMoon : IconSun}
        aria-label={t`Toggle light and dark theme`}
        accent="tertiary"
        active={isDark}
        onClick={handleCycleTheme}
        title={isDark ? t`Dark` : t`Light`}
      />
    </StyledContainer>
  );
};
