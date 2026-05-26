import { Trans, useLingui } from '@lingui/react/macro';
import { useCallback, useEffect, useState } from 'react';

import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import {
  ENTERPRISE_PLAN_MODAL_ID,
  EnterprisePlanModal,
} from '@/settings/enterprise/components/EnterprisePlanModal';
import { REFRESH_ENTERPRISE_VALIDITY_TOKEN } from '@/settings/enterprise/graphql/mutations/refreshEnterpriseValidityToken';
import { SET_ENTERPRISE_KEY } from '@/settings/enterprise/graphql/mutations/setEnterpriseKey';
import { ENTERPRISE_PORTAL_SESSION } from '@/settings/enterprise/graphql/queries/enterprisePortalSession';
import { ENTERPRISE_SUBSCRIPTION_STATUS } from '@/settings/enterprise/graphql/queries/enterpriseSubscriptionStatus';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useLoadCurrentUser } from '@/users/hooks/useLoadCurrentUser';
import { CombinedGraphQLErrors } from '@apollo/client';
import { useLazyQuery, useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { H2Title, IconKey } from 'twenty-ui/display';
import { Button } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { EnterpriseSubscriptionStatusSection } from './EnterpriseSubscriptionStatusSection';

type SettingsEnterpriseProps = {
  isAdminPanelTab?: boolean;
};

type SubscriptionStatus = {
  status: string | null;
  licensee: string | null;
  expiresAt: string | null;
  cancelAt: string | null;
  currentPeriodEnd: string | null;
  isCancellationScheduled: boolean;
};

const StyledInputContainer = styled.div`
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

const StyledInputWrapper = styled.div`
  flex: 1;
  min-width: 0;
`;

const StyledActivateButtonWrapper = styled.div`
  flex-shrink: 0;
`;

export const SettingsEnterprise = ({
  isAdminPanelTab = false,
}: SettingsEnterpriseProps = {}) => {
  const { t } = useLingui();
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);
  const [enterpriseKey, setEnterpriseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [setEnterpriseKeyMutation] = useMutation<{
    setEnterpriseKey: {
      isValid: boolean;
      licensee: string | null;
      expiresAt: string | null;
      subscriptionId: string | null;
    };
  }>(SET_ENTERPRISE_KEY);
  const [refreshValidityTokenMutation] = useMutation<{
    refreshEnterpriseValidityToken: boolean;
  }>(REFRESH_ENTERPRISE_VALIDITY_TOKEN);
  const [fetchPortalSession] = useLazyQuery<{
    enterprisePortalSession: string | null;
  }>(ENTERPRISE_PORTAL_SESSION);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const { openModal } = useModal();
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();
  const { loadCurrentUser } = useLoadCurrentUser();

  const hasSignedEnterpriseKey =
    currentWorkspace?.hasValidSignedEnterpriseKey === true;
  const hasValidityToken =
    currentWorkspace?.hasValidEnterpriseValidityToken === true;

  const [fetchSubscriptionStatus] = useLazyQuery<{
    enterpriseSubscriptionStatus: SubscriptionStatus | null;
  }>(ENTERPRISE_SUBSCRIPTION_STATUS, { fetchPolicy: 'network-only' });

  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus | null>(null);
  const [isStatusLoaded, setIsStatusLoaded] = useState(false);

  useEffect(() => {
    if (!hasSignedEnterpriseKey) {
      setIsStatusLoaded(true);

      return;
    }

    const loadStatus = async () => {
      const { data } = await fetchSubscriptionStatus();

      setSubscriptionStatus(data?.enterpriseSubscriptionStatus ?? null);
      setIsStatusLoaded(true);
    };

    loadStatus();
  }, [hasSignedEnterpriseKey, fetchSubscriptionStatus]);

  const handleActivate = useCallback(async () => {
    if (!enterpriseKey.trim()) return;

    setIsActivating(true);

    try {
      const result = await setEnterpriseKeyMutation({
        variables: { enterpriseKey: enterpriseKey.trim() },
      });

      if (result.data?.setEnterpriseKey.isValid === true) {
        enqueueSuccessSnackBar({
          message: t`Enterprise license activated successfully`,
        });
        setEnterpriseKey('');
        const { data: statusData } = await fetchSubscriptionStatus();

        setSubscriptionStatus(statusData?.enterpriseSubscriptionStatus ?? null);
        await loadCurrentUser();
      } else {
        enqueueErrorSnackBar({
          message: t`Failed to activate enterprise license. Please check your key or contact support.`,
        });
      }
    } catch (error) {
      if (
        CombinedGraphQLErrors.is(error) &&
        error.errors?.[0]?.extensions?.subCode ===
          'CONFIG_VARIABLES_IN_DB_DISABLED'
      ) {
        enqueueErrorSnackBar({
          apolloError: error,
          options: { duration: 10000 },
        });
      } else {
        enqueueErrorSnackBar({
          message: t`Error activating enterprise license`,
        });
      }
    } finally {
      setIsActivating(false);
    }
  }, [
    enterpriseKey,
    setEnterpriseKeyMutation,
    enqueueErrorSnackBar,
    enqueueSuccessSnackBar,
    fetchSubscriptionStatus,
    loadCurrentUser,
    t,
  ]);

  const returnUrlPath = isAdminPanelTab
    ? getSettingsPath(SettingsPath.AdminPanelEnterprise)
    : getSettingsPath(SettingsPath.Enterprise);

  const openBillingPortal = useCallback(async () => {
    try {
      const { data } = await fetchPortalSession({
        variables: { returnUrlPath },
      });

      const portalUrl = data?.enterprisePortalSession;

      if (portalUrl !== null && portalUrl !== undefined) {
        window.open(portalUrl, '_blank', 'noopener');
      } else {
        enqueueErrorSnackBar({
          message: t`Could not open billing portal. Please check your enterprise key is present, or contact support.`,
        });
      }
    } catch {
      enqueueErrorSnackBar({
        message: t`Error opening billing portal`,
      });
    }
  }, [fetchPortalSession, enqueueErrorSnackBar, t, returnUrlPath]);

  const openCheckoutModal = useCallback(() => {
    openModal(ENTERPRISE_PLAN_MODAL_ID);
  }, [openModal]);

  const handleRefreshValidityToken = useCallback(async () => {
    setIsRefreshingToken(true);

    try {
      const { data } = await refreshValidityTokenMutation();

      if (data?.refreshEnterpriseValidityToken === true) {
        enqueueSuccessSnackBar({
          message: t`Validity token refreshed successfully`,
        });
        await loadCurrentUser();
      } else {
        enqueueErrorSnackBar({
          message: t`Could not refresh validity token. Please contact support.`,
        });
      }
    } catch {
      enqueueErrorSnackBar({
        message: t`Error refreshing validity token. Please contact support.`,
      });
    } finally {
      setIsRefreshingToken(false);
    }
  }, [
    refreshValidityTokenMutation,
    enqueueSuccessSnackBar,
    enqueueErrorSnackBar,
    loadCurrentUser,
    t,
  ]);

  const activateKeySection = (
    <Section>
      <H2Title
        title={t`Activate Enterprise Key`}
        description={t`Paste your enterprise key below to activate`}
      />
      <StyledInputContainer>
        <StyledInputWrapper>
          <SettingsTextInput
            instanceId="enterprise-key-input"
            value={enterpriseKey}
            onChange={(value) => setEnterpriseKey(value)}
            placeholder={t`Paste your enterprise key here`}
            fullWidth
            onInputEnter={handleActivate}
          />
        </StyledInputWrapper>
        <StyledActivateButtonWrapper>
          <Button
            Icon={IconKey}
            title={isActivating ? t`Activating...` : t`Activate`}
            accent="blue"
            onClick={handleActivate}
            disabled={isActivating || !enterpriseKey.trim()}
          />
        </StyledActivateButtonWrapper>
      </StyledInputContainer>
    </Section>
  );

  const innerContent = (
    <>
      <EnterprisePlanModal />
      {isStatusLoaded && (
        <EnterpriseSubscriptionStatusSection
          subscriptionStatus={subscriptionStatus}
          hasSignedEnterpriseKey={hasSignedEnterpriseKey}
          hasValidityToken={hasValidityToken}
          activateKeySection={activateKeySection}
          onOpenBillingPortal={openBillingPortal}
          onOpenCheckoutModal={openCheckoutModal}
          onRefreshValidityToken={handleRefreshValidityToken}
          isRefreshingToken={isRefreshingToken}
        />
      )}
    </>
  );

  if (isAdminPanelTab) {
    return innerContent;
  }

  return (
    <SubMenuTopBarContainer
      title={t`Enterprise`}
      links={[
        {
          children: <Trans>Workspace</Trans>,
          href: getSettingsPath(SettingsPath.Workspace),
        },
        { children: <Trans>Enterprise</Trans> },
      ]}
    >
      <SettingsPageContainer>{innerContent}</SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
