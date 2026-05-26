import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback } from 'react';
import { styled } from '@linaria/react';

import { SubscriptionInfoContainer } from '@/settings/billing/components/SubscriptionInfoContainer';
import { SubscriptionInfoRowContainer } from '@/settings/billing/components/internal/SubscriptionInfoRowContainer';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import {
  H2Title,
  IconCalendarRepeat,
  IconCheck,
  IconCircleX,
  IconCreditCard,
  IconKey,
  IconUser,
} from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { isDefined } from 'twenty-shared/utils';

type SubscriptionStatus = {
  status: string | null;
  licensee: string | null;
  expiresAt: string | null;
  cancelAt: string | null;
  currentPeriodEnd: string | null;
  isCancellationScheduled: boolean;
};

type EnterpriseSubscriptionStatusSectionProps = {
  subscriptionStatus: SubscriptionStatus | null;
  hasSignedEnterpriseKey: boolean;
  hasValidityToken: boolean;
  activateKeySection: React.ReactNode;
  onOpenBillingPortal: () => void;
  onOpenCheckoutModal: () => void;
  onRefreshValidityToken: () => void;
  isRefreshingToken: boolean;
};

const StyledStatusDot = styled.div<{ isActive: boolean }>`
  background-color: ${({ isActive }) =>
    isActive ? themeCssVariables.color.green : themeCssVariables.color.red};
  border-radius: 50%;
  height: 8px;
  width: 8px;
`;

const StyledStatusContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledCancellationNotice = styled.div`
  color: ${themeCssVariables.font.color.danger};
  font-size: ${themeCssVariables.font.size.sm};
  margin-top: ${themeCssVariables.spacing[3]};
`;

const StyledSpacer = styled.div`
  height: ${themeCssVariables.spacing[4]};
`;

export const EnterpriseSubscriptionStatusSection = ({
  subscriptionStatus,
  hasSignedEnterpriseKey,
  hasValidityToken,
  activateKeySection,
  onOpenBillingPortal,
  onOpenCheckoutModal,
  onRefreshValidityToken,
  isRefreshingToken,
}: EnterpriseSubscriptionStatusSectionProps) => {
  const { t } = useLingui();

  const hasOrphanedValidityToken = hasValidityToken && !hasSignedEnterpriseKey;

  const stripeStatus = subscriptionStatus?.status ?? null;
  const isSubscriptionActiveOrTrialing =
    stripeStatus === 'active' || stripeStatus === 'trialing';
  const isCancelScheduled =
    subscriptionStatus?.isCancellationScheduled === true;
  const isCanceled = stripeStatus === 'canceled';
  const isPastDue = stripeStatus === 'past_due' || stripeStatus === 'unpaid';
  const isIncomplete =
    stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired';

  const licensee = subscriptionStatus?.licensee ?? null;
  const expiresAt = subscriptionStatus?.expiresAt
    ? new Date(subscriptionStatus.expiresAt)
    : null;

  const cancelAt = isDefined(subscriptionStatus?.cancelAt)
    ? new Date(subscriptionStatus.cancelAt)
    : null;

  const cancelAtDate =
    isCancelScheduled && isDefined(cancelAt)
      ? cancelAt.toLocaleDateString()
      : '';

  const cancellationMessage =
    isCancelScheduled && isDefined(cancelAt)
      ? t`Your enterprise features will remain active until ${cancelAtDate}.`
      : null;

  if (hasOrphanedValidityToken) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={t`Your enterprise features are active but your enterprise key is missing or invalid. This may be expected, but if not, please set a valid signed enterprise key to manage your subscription, or contact support.`}
          />
          <Button
            Icon={IconKey}
            title={t`Get Enterprise Key`}
            variant="secondary"
            onClick={onOpenCheckoutModal}
          />
        </Section>
        {activateKeySection}
      </>
    );
  }

  if (!hasSignedEnterpriseKey) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Get Enterprise`}
            description={t`Unlock enterprise features like SSO, row-level security, and audit logs.`}
          />
          <Button
            Icon={IconKey}
            title={t`Get Enterprise Key`}
            variant="secondary"
            onClick={onOpenCheckoutModal}
          />
        </Section>
        {activateKeySection}
      </>
    );
  }

  if (isSubscriptionActiveOrTrialing && !hasValidityToken) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={t`Your subscription is active but your validity token is invalid or has expired. Try reloading it or contact support.`}
          />
          <Button
            Icon={IconKey}
            title={
              isRefreshingToken ? t`Reloading...` : t`Reload validity token`
            }
            variant="secondary"
            accent="blue"
            onClick={onRefreshValidityToken}
            disabled={isRefreshingToken}
          />
          <StyledSpacer />
          <SubscriptionInfoContainer>
            <SubscriptionInfoRowContainer
              label={t`Status`}
              Icon={IconCheck}
              currentValue={
                <StyledStatusContainer>
                  <StyledStatusDot isActive={true} />
                  {stripeStatus === 'trialing' ? (
                    <Trans>Trial</Trans>
                  ) : (
                    <Trans>Active</Trans>
                  )}
                </StyledStatusContainer>
              }
            />
            {licensee && (
              <SubscriptionInfoRowContainer
                label={t`Licensee`}
                Icon={IconUser}
                currentValue={licensee}
              />
            )}
            {expiresAt && (
              <SubscriptionInfoRowContainer
                label={t`Valid until`}
                Icon={IconCalendarRepeat}
                currentValue={new Date(expiresAt).toLocaleDateString()}
              />
            )}
          </SubscriptionInfoContainer>
        </Section>
        <Section>
          <H2Title
            title={t`Manage billing information`}
            description={t`Edit payment method, see your invoices and more`}
          />
          <Button
            Icon={IconCreditCard}
            title={t`View billing details`}
            variant="secondary"
            onClick={onOpenBillingPortal}
          />
        </Section>
      </>
    );
  }

  if (isSubscriptionActiveOrTrialing) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={
              isCancelScheduled
                ? t`Your subscription is scheduled for cancellation`
                : t`Your enterprise features are active`
            }
          />
          <SubscriptionInfoContainer>
            <SubscriptionInfoRowContainer
              label={t`Status`}
              Icon={IconCheck}
              currentValue={
                <StyledStatusContainer>
                  <StyledStatusDot isActive={!isCancelScheduled} />
                  {isCancelScheduled ? (
                    <Trans>Cancelling</Trans>
                  ) : stripeStatus === 'trialing' ? (
                    <Trans>Trial</Trans>
                  ) : (
                    <Trans>Active</Trans>
                  )}
                </StyledStatusContainer>
              }
            />
            {licensee && (
              <SubscriptionInfoRowContainer
                label={t`Licensee`}
                Icon={IconUser}
                currentValue={licensee}
              />
            )}
            {expiresAt && (
              <SubscriptionInfoRowContainer
                label={isCancelScheduled ? t`Cancels on` : t`Valid until`}
                Icon={IconCalendarRepeat}
                currentValue={new Date(expiresAt).toLocaleDateString()}
              />
            )}
          </SubscriptionInfoContainer>
          {cancellationMessage && (
            <StyledCancellationNotice>
              {cancellationMessage}
            </StyledCancellationNotice>
          )}
        </Section>
        <Section>
          <H2Title
            title={t`Manage billing information`}
            description={t`Edit payment method, see your invoices and more`}
          />
          <Button
            Icon={IconCreditCard}
            title={t`View billing details`}
            variant="secondary"
            onClick={onOpenBillingPortal}
          />
        </Section>
        {!isCancelScheduled && (
          <Section>
            <H2Title
              title={t`Cancel your subscription`}
              description={t`Your enterprise features will be disabled`}
            />
            <Button
              Icon={IconCircleX}
              title={t`Cancel Plan`}
              variant="secondary"
              accent="danger"
              onClick={onOpenBillingPortal}
            />
          </Section>
        )}
      </>
    );
  }

  if (isCanceled) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={t`Your enterprise subscription has been canceled.`}
          />
          <SubscriptionInfoContainer>
            <SubscriptionInfoRowContainer
              label={t`Status`}
              Icon={IconCheck}
              currentValue={
                <StyledStatusContainer>
                  <StyledStatusDot isActive={false} />
                  <Trans>Canceled</Trans>
                </StyledStatusContainer>
              }
            />
            <SubscriptionInfoRowContainer
              label={t`Billing history`}
              Icon={IconCreditCard}
              currentValue={
                <Button
                  title={t`View invoices`}
                  variant="secondary"
                  size="small"
                  onClick={onOpenBillingPortal}
                />
              }
            />
          </SubscriptionInfoContainer>
        </Section>
        <Section>
          <H2Title
            title={t`Get Enterprise`}
            description={t`Start a new enterprise subscription to re-enable enterprise features.`}
          />
          <Button
            Icon={IconKey}
            title={t`Get Enterprise Key`}
            variant="secondary"
            onClick={onOpenCheckoutModal}
          />
        </Section>
        {activateKeySection}
      </>
    );
  }

  if (isPastDue) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={t`There is a payment issue with your subscription. Please update your payment method.`}
          />
          <SubscriptionInfoContainer>
            <SubscriptionInfoRowContainer
              label={t`Status`}
              Icon={IconCheck}
              currentValue={
                <StyledStatusContainer>
                  <StyledStatusDot isActive={false} />
                  <Trans>Payment issue</Trans>
                </StyledStatusContainer>
              }
            />
          </SubscriptionInfoContainer>
        </Section>
        <Section>
          <H2Title
            title={t`Update payment method`}
            description={t`Fix the payment issue to keep your enterprise features active.`}
          />
          <Button
            Icon={IconCreditCard}
            title={t`Go to billing portal`}
            variant="secondary"
            accent="blue"
            onClick={onOpenBillingPortal}
          />
        </Section>
      </>
    );
  }

  if (isIncomplete) {
    return (
      <>
        <Section>
          <H2Title
            title={t`Enterprise License`}
            description={t`Your subscription setup was not completed.`}
          />
          <SubscriptionInfoContainer>
            <SubscriptionInfoRowContainer
              label={t`Status`}
              Icon={IconCheck}
              currentValue={
                <StyledStatusContainer>
                  <StyledStatusDot isActive={false} />
                  <Trans>Incomplete</Trans>
                </StyledStatusContainer>
              }
            />
          </SubscriptionInfoContainer>
        </Section>
        <Section>
          <H2Title
            title={t`Get Enterprise`}
            description={t`Start a new enterprise subscription.`}
          />
          <Button
            Icon={IconKey}
            title={t`Get Enterprise Key`}
            onClick={onOpenCheckoutModal}
          />
        </Section>
        {activateKeySection}
      </>
    );
  }

  return (
    <>
      <Section>
        <H2Title
          title={t`Enterprise License`}
          description={(() => {
            const statusLabel = stripeStatus ?? 'unknown';

            return t`Your subscription status is: ${statusLabel}`;
          })()}
        />
        <Button
          Icon={IconCreditCard}
          title={t`Go to billing portal`}
          variant="secondary"
          onClick={onOpenBillingPortal}
        />
      </Section>
      {activateKeySection}
    </>
  );
};
