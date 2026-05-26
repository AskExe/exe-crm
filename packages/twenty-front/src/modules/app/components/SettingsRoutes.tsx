import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { SettingsProtectedRouteWrapper } from '@/settings/components/SettingsProtectedRouteWrapper';
import { SettingsSkeletonLoader } from '@/settings/components/SettingsSkeletonLoader';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import {
  FeatureFlagKey,
  PermissionFlagType,
} from '~/generated-metadata/graphql';

import {
  SettingsAboutExeCRM,
  SettingsAccountsCalendars,
  SettingsAccountsConfiguration,
  SettingsAccountsEmails,
  SettingsAccounts,
  SettingsAdmin,
  SettingsAdminAiProviderDetail,
  SettingsAdminConfigVariableDetails,
  SettingsAdminIndicatorHealthStatus,
  SettingsAdminNewAiModel,
  SettingsAdminNewAiProvider,
  SettingsAdminQueueDetail,
  SettingsAgentForm,
  SettingsAgentTurnDetail,
  SettingsAI,
  SettingsAIPrompts,
  SettingsAIUsageUserDetail,
  SettingsApiWebhooks,
  SettingsApplicationDetails,
  SettingsApplicationRegistrationDetails,
  SettingsApplications,
  SettingsAvailableApplicationDetails,
  SettingsBilling,
  SettingsDevelopersApiKeyDetail,
  SettingsDevelopersApiKeysNew,
  SettingsDevelopersWebhookDetail,
  SettingsDevelopersWebhookNew,
  SettingsEditImapSmtpCaldavConnection,
  SettingsEmailingDomainDetail,
  SettingsExperience,
  SettingsGraphQLPlayground,
  SettingsLogicFunctionDetail,
  SettingsNewAccount,
  SettingsNewEmailingDomain,
  SettingsNewImapSmtpCaldavConnection,
  SettingsNewObject,
  SettingsObjectDetailPage,
  SettingsObjectFieldEdit,
  SettingsObjectNewFieldConfigure,
  SettingsObjectNewFieldSelect,
  SettingsObjectOverview,
  SettingsObjects,
  SettingsProfile,
  SettingsRestPlayground,
  SettingsRoleAddObjectLevel,
  SettingsRoleCreate,
  SettingsRoleEdit,
  SettingsRoleObjectLevel,
  SettingsRoles,
  SettingsSkillForm,
  SettingsTwoFactorAuthenticationMethod,
  SettingsUpdates,
  SettingsUsage,
  SettingsUsageUserDetail,
  SettingsWorkspace,
  SettingsWorkspaceMember,
  SettingsWorkspaceMembers,
} from './SettingsRoutesLazy';

type SettingsRoutesProps = {
  isFunctionSettingsEnabled?: boolean;
  isAdminPageEnabled?: boolean;
};

export const SettingsRoutes = ({ isAdminPageEnabled }: SettingsRoutesProps) => (
  <Suspense fallback={<SettingsSkeletonLoader />}>
    <Routes>
      <Route path={SettingsPath.ProfilePage} element={<SettingsProfile />} />
      <Route
        path={SettingsPath.TwoFactorAuthenticationStrategyConfig}
        element={<SettingsTwoFactorAuthenticationMethod />}
      />
      <Route path={SettingsPath.Experience} element={<SettingsExperience />} />
      <Route path={SettingsPath.About} element={<SettingsAboutExeCRM />} />
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.CONNECTED_ACCOUNTS}
          />
        }
      >
        <Route path={SettingsPath.Accounts} element={<SettingsAccounts />} />
        <Route
          path={SettingsPath.NewAccount}
          element={<SettingsNewAccount />}
        />
        <Route
          path={SettingsPath.AccountsConfiguration}
          element={<SettingsAccountsConfiguration />}
        />
        <Route
          path={SettingsPath.AccountsCalendars}
          element={<SettingsAccountsCalendars />}
        />
        <Route
          path={SettingsPath.AccountsEmails}
          element={<SettingsAccountsEmails />}
        />
        <Route
          path={SettingsPath.NewImapSmtpCaldavConnection}
          element={<SettingsNewImapSmtpCaldavConnection />}
        />
        <Route
          path={SettingsPath.EditImapSmtpCaldavConnection}
          element={<SettingsEditImapSmtpCaldavConnection />}
        />
      </Route>
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.WORKSPACE}
          />
        }
      >
        <Route path={SettingsPath.Workspace} element={<SettingsWorkspace />} />
        <Route
          path={SettingsPath.ApiWebhooks}
          element={<SettingsApiWebhooks />}
        />
        <Route path={SettingsPath.AI} element={<SettingsAI />} />
        <Route path={SettingsPath.AIPrompts} element={<SettingsAIPrompts />} />
        <Route
          path={SettingsPath.AINewAgent}
          element={<SettingsAgentForm mode="create" />}
        />
        <Route
          path={SettingsPath.AIAgentDetail}
          element={<SettingsAgentForm mode="edit" />}
        />
        <Route
          path={SettingsPath.AIAgentTurnDetail}
          element={<SettingsAgentTurnDetail />}
        />
        <Route
          path={SettingsPath.AINewSkill}
          element={<SettingsSkillForm mode="create" />}
        />
        <Route
          path={SettingsPath.AISkillDetail}
          element={<SettingsSkillForm mode="edit" />}
        />
        <Route
          path={SettingsPath.AIUsageUserDetail}
          element={<SettingsAIUsageUserDetail />}
        />
        <Route
          path={SettingsPath.LogicFunctionDetail}
          element={<SettingsLogicFunctionDetail />}
        />
        <Route path={SettingsPath.Billing} element={<SettingsBilling />} />
        <Route
          element={
            <SettingsProtectedRouteWrapper
              requiredFeatureFlag={FeatureFlagKey.IS_USAGE_ANALYTICS_ENABLED}
            />
          }
        >
          <Route path={SettingsPath.Usage} element={<SettingsUsage />} />
          <Route
            path={SettingsPath.UsageUserDetail}
            element={<SettingsUsageUserDetail />}
          />
        </Route>
        <Route
          path={SettingsPath.NewEmailingDomain}
          element={<SettingsNewEmailingDomain />}
        />
        <Route
          path={SettingsPath.EmailingDomainDetail}
          element={<SettingsEmailingDomainDetail />}
        />
      </Route>
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.WORKSPACE_MEMBERS}
          />
        }
      >
        <Route
          path={SettingsPath.WorkspaceMembersPage}
          element={<SettingsWorkspaceMembers />}
        />
        <Route
          path={SettingsPath.WorkspaceMemberPage}
          element={<SettingsWorkspaceMember />}
        />
      </Route>
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.DATA_MODEL}
          />
        }
      >
        <Route path={SettingsPath.Objects} element={<SettingsObjects />} />
        <Route
          path={SettingsPath.ObjectOverview}
          element={<SettingsObjectOverview />}
        />
        <Route
          path={SettingsPath.ObjectDetail}
          element={<SettingsObjectDetailPage />}
        />
        <Route path={SettingsPath.NewObject} element={<SettingsNewObject />} />
        <Route
          path={SettingsPath.ObjectNewFieldSelect}
          element={<SettingsObjectNewFieldSelect />}
        />
        <Route
          path={SettingsPath.ObjectNewFieldConfigure}
          element={<SettingsObjectNewFieldConfigure />}
        />
        <Route
          path={SettingsPath.ObjectFieldEdit}
          element={<SettingsObjectFieldEdit />}
        />
      </Route>
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.ROLES}
          />
        }
      >
        <Route path={SettingsPath.Roles} element={<SettingsRoles />} />
        <Route path={SettingsPath.RoleDetail} element={<SettingsRoleEdit />} />
        <Route
          path={SettingsPath.RoleCreate}
          element={<SettingsRoleCreate />}
        />
        <Route
          path={SettingsPath.RoleObjectLevel}
          element={<SettingsRoleObjectLevel />}
        />
        <Route
          path={SettingsPath.RoleAddObjectLevel}
          element={<SettingsRoleAddObjectLevel />}
        />
      </Route>
      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.API_KEYS_AND_WEBHOOKS}
          />
        }
      >
        <Route
          path={`${SettingsPath.GraphQLPlayground}`}
          element={<SettingsGraphQLPlayground />}
        />
        <Route
          path={`${SettingsPath.RestPlayground}/*`}
          element={<SettingsRestPlayground />}
        />
        <Route
          path={SettingsPath.NewApiKey}
          element={<SettingsDevelopersApiKeysNew />}
        />
        <Route
          path={SettingsPath.ApiKeyDetail}
          element={<SettingsDevelopersApiKeyDetail />}
        />
        <Route
          path={SettingsPath.NewWebhook}
          element={<SettingsDevelopersWebhookNew />}
        />
        <Route
          path={SettingsPath.WebhookDetail}
          element={<SettingsDevelopersWebhookDetail />}
        />
      </Route>

      <Route
        element={
          <SettingsProtectedRouteWrapper
            requiredFeatureFlag={FeatureFlagKey.IS_APPLICATION_ENABLED}
          />
        }
      >
        <Route
          path={SettingsPath.Applications}
          element={<SettingsApplications />}
        />
        <Route
          path={SettingsPath.ApplicationDetail}
          element={<SettingsApplicationDetails />}
        />
        <Route
          path={SettingsPath.AvailableApplicationDetail}
          element={<SettingsAvailableApplicationDetails />}
        />
        <Route
          path={SettingsPath.ApplicationRegistrationDetail}
          element={<SettingsApplicationRegistrationDetails />}
        />
        <Route
          path={SettingsPath.ApplicationLogicFunctionDetail}
          element={<SettingsLogicFunctionDetail />}
        />
      </Route>

      {isAdminPageEnabled && (
        <>
          <Route path={SettingsPath.AdminPanel} element={<SettingsAdmin />} />
          <Route
            path={SettingsPath.Enterprise}
            element={
              <Navigate
                to={getSettingsPath(SettingsPath.AdminPanelEnterprise)}
                replace
              />
            }
          />
          <Route
            path={SettingsPath.AdminPanelIndicatorHealthStatus}
            element={<SettingsAdminIndicatorHealthStatus />}
          />
          <Route
            path={SettingsPath.AdminPanelQueueDetail}
            element={<SettingsAdminQueueDetail />}
          />

          <Route
            path={SettingsPath.AdminPanelConfigVariableDetails}
            element={<SettingsAdminConfigVariableDetails />}
          />
          <Route
            path={SettingsPath.AdminPanelNewAiProvider}
            element={<SettingsAdminNewAiProvider />}
          />
          <Route
            path={SettingsPath.AdminPanelNewAiModel}
            element={<SettingsAdminNewAiModel />}
          />
          <Route
            path={SettingsPath.AdminPanelAiProviderDetail}
            element={<SettingsAdminAiProviderDetail />}
          />
        </>
      )}

      <Route
        element={
          <SettingsProtectedRouteWrapper
            settingsPermission={PermissionFlagType.WORKSPACE}
          />
        }
      >
        <Route path={SettingsPath.Updates} element={<SettingsUpdates />} />
      </Route>
    </Routes>
  </Suspense>
);
