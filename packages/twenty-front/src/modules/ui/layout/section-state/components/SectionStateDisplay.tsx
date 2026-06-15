import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { IconAlertCircle, IconAlertTriangle, IconRefresh } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';
import { useContext } from 'react';

export type SectionStateVariant = 'loading' | 'error' | 'empty' | 'connectionError';

type SectionStateDisplayProps = {
  variant: SectionStateVariant;
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
  minHeight?: string;
};

const StyledContainer = styled.div<{ minHeight: string }>`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  justify-content: center;
  min-height: ${({ minHeight }) => minHeight};
  padding: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const StyledIconContainer = styled.div<{ color: string }>`
  align-items: center;
  color: ${({ color }) => color};
  display: flex;
  justify-content: center;
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.md};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledSubtitle = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  line-height: ${themeCssVariables.text.lineHeight.lg};
  text-align: center;
`;

const StyledSkeletonBar = styled.div`
  animation: pulse 1.5s ease-in-out infinite;
  background: ${themeCssVariables.background.tertiary};
  border-radius: ${themeCssVariables.border.radius.sm};
  height: 12px;

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
`;

const StyledSkeletonContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
  width: 100%;
`;

const LoadingSkeleton = () => (
  <StyledSkeletonContainer>
    <StyledSkeletonBar style={{ width: '75%' }} />
    <StyledSkeletonBar style={{ width: '100%' }} />
    <StyledSkeletonBar style={{ width: '60%' }} />
  </StyledSkeletonContainer>
);

export const SectionStateDisplay = ({
  variant,
  title,
  subtitle,
  onRetry,
  minHeight = '120px',
}: SectionStateDisplayProps) => {
  const { theme } = useContext(ThemeContext);

  if (variant === 'loading') {
    return (
      <StyledContainer minHeight={minHeight}>
        <LoadingSkeleton />
      </StyledContainer>
    );
  }

  const defaultTitles: Record<Exclude<SectionStateVariant, 'loading'>, string> = {
    error: t`Something went wrong`,
    empty: t`No data available`,
    connectionError: t`Unable to connect`,
  };

  const defaultSubtitles: Record<Exclude<SectionStateVariant, 'loading'>, string> = {
    error: t`This section encountered an error. Try refreshing.`,
    empty: t`There's nothing to display here yet.`,
    connectionError: t`Could not reach the database. This section will reload when the connection is restored.`,
  };

  const displayTitle = title ?? defaultTitles[variant];
  const displaySubtitle = subtitle ?? defaultSubtitles[variant];

  const Icon = variant === 'connectionError' ? IconAlertTriangle : IconAlertCircle;
  const iconColor =
    variant === 'empty'
      ? theme.font.color.light
      : variant === 'connectionError'
        ? theme.color.orange
        : theme.color.red;

  return (
    <StyledContainer minHeight={minHeight}>
      <StyledIconContainer color={iconColor}>
        <Icon size={theme.icon.size.lg} />
      </StyledIconContainer>
      <StyledTitle>{displayTitle}</StyledTitle>
      <StyledSubtitle>{displaySubtitle}</StyledSubtitle>
      {onRetry && (
        <Button
          Icon={IconRefresh}
          title={t`Retry`}
          variant="secondary"
          size="small"
          onClick={onRetry}
        />
      )}
    </StyledContainer>
  );
};
