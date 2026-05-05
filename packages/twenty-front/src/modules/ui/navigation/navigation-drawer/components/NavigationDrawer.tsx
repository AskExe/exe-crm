import { styled } from '@linaria/react';
import { type ReactNode, useState } from 'react';

import { useIsSettingsDrawer } from '@/navigation/hooks/useIsSettingsDrawer';
import { tableWidthResizeIsActiveState } from '@/object-record/record-table/states/tableWidthResizeIsActivedState';
import { ResizablePanelEdge } from '@/ui/layout/resizable-panel/components/ResizablePanelEdge';
import { NAVIGATION_DRAWER_COLLAPSED_WIDTH } from '@/ui/layout/resizable-panel/constants/NavigationDrawerCollapsedWidth';
import { NAVIGATION_DRAWER_CONSTRAINTS } from '@/ui/layout/resizable-panel/constants/NavigationDrawerConstraints';
import { NavigationDrawerWidthEffect } from '@/ui/navigation/components/NavigationDrawerWidthEffect';
import { NAVIGATION_DRAWER_CLICK_OUTSIDE_ID } from '@/ui/navigation/navigation-drawer/constants/NavigationDrawerClickOutsideId';
import { isNavigationDrawerExpandedState } from '@/ui/navigation/states/isNavigationDrawerExpanded';
import { navigationDrawerActiveTabState } from '@/ui/navigation/states/navigationDrawerActiveTabState';
import { NAVIGATION_DRAWER_TABS } from '@/ui/navigation/states/navigationDrawerTabs';
import {
  NAVIGATION_DRAWER_WIDTH_VAR,
  navigationDrawerWidthState,
} from '@/ui/navigation/states/navigationDrawerWidthState';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui/theme-constants';
import { NavigationDrawerBackButton } from './NavigationDrawerBackButton';
import { NavigationDrawerHeader } from './NavigationDrawerHeader';
import { NavigationDrawerThemeToggle } from './NavigationDrawerThemeToggle';

export type NavigationDrawerProps = {
  children?: ReactNode;
  className?: string;
  title: string;
};

const StyledAnimatedContainer = styled.div<{
  isExpanded: boolean;
  isResizing: boolean;
}>`
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  position: relative;
  transition: ${({ isResizing }) =>
    isResizing
      ? 'none'
      : `width calc(${themeCssVariables.animation.duration.normal} * 1s)`};
  width: ${({ isExpanded }) =>
    isExpanded
      ? `var(${NAVIGATION_DRAWER_WIDTH_VAR})`
      : `${NAVIGATION_DRAWER_COLLAPSED_WIDTH}px`};

  @media (max-width: ${MOBILE_VIEWPORT}px) {
    width: ${({ isExpanded }) => (isExpanded ? '100%' : '0')};
  }
`;

const StyledContainer = styled.div<{
  isSettings?: boolean;
  isMobile?: boolean;
  isExpanded?: boolean;
}>`
  position: relative;
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
      420px 220px at 0% 0%,
      rgba(245, 215, 110, 0.14),
      rgba(15, 14, 26, 0) 58%
    ),
    linear-gradient(180deg, #0f0e1a 0%, #15142a 100%);
  border-right: 1px solid rgba(240, 237, 232, 0.08);
  box-sizing: border-box;
  color: #f0ede8;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  height: 100%;
  padding: ${({ isSettings, isMobile }) =>
    isSettings
      ? isMobile
        ? `${themeCssVariables.spacing[3]} 0 0 ${themeCssVariables.spacing[8]}`
        : `${themeCssVariables.spacing[3]} 0 ${themeCssVariables.spacing[4]} 0`
      : `${themeCssVariables.spacing[3]} 0 ${themeCssVariables.spacing[14]} ${themeCssVariables.spacing[2]}`};
  width: ${({ isExpanded }) =>
    isExpanded ? `var(${NAVIGATION_DRAWER_WIDTH_VAR})` : '100%'};
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    width: 100%;
    padding-left: ${themeCssVariables.spacing[5]};
    padding-right: ${themeCssVariables.spacing[5]};
  }
`;

export const NavigationDrawer = ({
  children,
  className,
  title,
}: NavigationDrawerProps) => {
  const [isResizing, setIsResizing] = useState(false);
  const isMobile = useIsMobile();
  const isSettingsDrawer = useIsSettingsDrawer();

  const [isNavigationDrawerExpanded, setIsNavigationDrawerExpanded] =
    useAtomState(isNavigationDrawerExpandedState);
  const [navigationDrawerWidth, setNavigationDrawerWidth] = useAtomState(
    navigationDrawerWidthState,
  );
  const setNavigationDrawerActiveTab = useSetAtomState(
    navigationDrawerActiveTabState,
  );
  const setTableWidthResizeIsActive = useSetAtomState(
    tableWidthResizeIsActiveState,
  );

  const handleCollapse = () => {
    setIsNavigationDrawerExpanded(false);
    setNavigationDrawerActiveTab(NAVIGATION_DRAWER_TABS.NAVIGATION_MENU);
    setIsResizing(false);
    setTableWidthResizeIsActive(true);
  };

  const handleWidthChange = (width: number) => {
    setNavigationDrawerWidth(width);
    setIsResizing(false);
    setTableWidthResizeIsActive(true);
  };

  const handleResizeStart = () => {
    setIsResizing(true);
    setTableWidthResizeIsActive(false);
  };

  return (
    <>
      <NavigationDrawerWidthEffect />
      <StyledAnimatedContainer
        className={className}
        data-click-outside-id={NAVIGATION_DRAWER_CLICK_OUTSIDE_ID}
        isExpanded={isNavigationDrawerExpanded}
        isResizing={isResizing}
      >
        <StyledContainer
          isSettings={isSettingsDrawer}
          isMobile={isMobile}
          isExpanded={isNavigationDrawerExpanded}
        >
          {isSettingsDrawer && title ? (
            <NavigationDrawerBackButton title={title} />
          ) : (
            <NavigationDrawerHeader showCollapseButton />
          )}
          {children}
          {!isSettingsDrawer && (
            <NavigationDrawerThemeToggle
              isExpanded={isNavigationDrawerExpanded}
            />
          )}
        </StyledContainer>

        {isNavigationDrawerExpanded && !isMobile && !isSettingsDrawer && (
          <ResizablePanelEdge
            side="right"
            constraints={NAVIGATION_DRAWER_CONSTRAINTS}
            currentWidth={navigationDrawerWidth}
            onWidthChange={handleWidthChange}
            onCollapse={handleCollapse}
            showHandle={false}
            cssVariableName={NAVIGATION_DRAWER_WIDTH_VAR}
            onResizeStart={handleResizeStart}
          />
        )}
      </StyledAnimatedContainer>
    </>
  );
};
