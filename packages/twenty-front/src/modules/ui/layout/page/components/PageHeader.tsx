import { styled } from '@linaria/react';
import { type ReactNode, useContext } from 'react';

import { NavigationDrawerCollapseButton } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerCollapseButton';

import { PAGE_ACTION_CONTAINER_CLICK_OUTSIDE_ID } from '@/ui/layout/page/constants/PageActionContainerClickOutsideId';
import { PAGE_BAR_MIN_HEIGHT } from '@/ui/layout/page/constants/PageBarMinHeight';
import { isNavigationDrawerExpandedState } from '@/ui/navigation/states/isNavigationDrawerExpanded';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { AnimatePresence } from 'framer-motion';
import { isDefined } from 'twenty-shared/utils';
import {
  type IconComponent,
  IconX,
  OverflowingTextWithTooltip,
} from 'twenty-ui/display';
import { LightIconButton } from 'twenty-ui/input';
import {
  MOBILE_VIEWPORT,
  ThemeContext,
  themeCssVariables,
} from 'twenty-ui/theme-constants';

const StyledTopBarContainer = styled.div<{ isMobile: boolean }>`
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

  align-items: center;
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
  flex-direction: row;
  font-size: ${themeCssVariables.font.size.lg};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  min-height: ${PAGE_BAR_MIN_HEIGHT}px;
  padding-bottom: ${themeCssVariables.spacing[3]};
  padding-left: ${({ isMobile }) =>
    isMobile ? themeCssVariables.spacing[3] : themeCssVariables.spacing[4]};
  padding-right: ${themeCssVariables.spacing[3]};
  padding-top: ${themeCssVariables.spacing[3]};
`;

const StyledLeftContainer = styled.div`
  align-items: center;
  display: flex;
  flex: 0 1 auto;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[1]};
  min-width: 0;
  overflow-x: hidden;
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    padding-left: ${themeCssVariables.spacing[1]};
  }
`;

const StyledTitleContainer = styled.div`
  align-items: center;
  display: flex;
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.medium};
  margin-right: ${themeCssVariables.spacing[1]};
  overflow: hidden;
  width: 100%;
`;

const StyledTopBarIconStyledTitleContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[1]};
  overflow: hidden;
  width: 100%;
`;

const StyledPageActionContainer = styled.div`
  align-items: center;
  display: flex;
  flex: 1 1 0;
  gap: ${themeCssVariables.spacing[2]};

  justify-content: flex-end;
  min-width: 0;
`;

const StyledIconContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: row;
`;

type PageHeaderProps = {
  title?: ReactNode;
  hasClosePageButton?: boolean;
  onClosePage?: () => void;
  Icon?: IconComponent;
  children?: ReactNode;
  className?: string;
};

export const PageHeader = ({
  title,
  hasClosePageButton,
  onClosePage,
  Icon,
  children,
  className,
}: PageHeaderProps) => {
  const isMobile = useIsMobile();
  const { theme } = useContext(ThemeContext);
  const isNavigationDrawerExpanded = useAtomStateValue(
    isNavigationDrawerExpandedState,
  );

  return (
    <AnimatePresence initial={false}>
      <StyledTopBarContainer className={className} isMobile={isMobile}>
        <StyledLeftContainer>
          {!isMobile && !isNavigationDrawerExpanded && (
            <NavigationDrawerCollapseButton direction="right" />
          )}
          {hasClosePageButton && (
            <LightIconButton
              Icon={IconX}
              size="small"
              accent="tertiary"
              onClick={() => onClosePage?.()}
            />
          )}

          <StyledTopBarIconStyledTitleContainer>
            {Icon && (
              <StyledIconContainer>
                <Icon size={theme.icon.size.md} />
              </StyledIconContainer>
            )}
            {isDefined(title) && (
              <StyledTitleContainer data-testid="top-bar-title">
                {typeof title === 'string' ? (
                  <OverflowingTextWithTooltip text={title} />
                ) : (
                  title
                )}
              </StyledTitleContainer>
            )}
          </StyledTopBarIconStyledTitleContainer>
        </StyledLeftContainer>
        <StyledPageActionContainer
          data-click-outside-id={PAGE_ACTION_CONTAINER_CLICK_OUTSIDE_ID}
        >
          {children}
        </StyledPageActionContainer>
      </StyledTopBarContainer>
    </AnimatePresence>
  );
};
