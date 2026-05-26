import { lazy } from 'react';

export const SettingsGraphQLPlayground = lazy(() =>
  import('~/pages/settings/developers/playground/SettingsGraphQLPlayground').then(
    (module) => ({
      default: module.SettingsGraphQLPlayground,
    }),
  ),
);

export const SettingsRestPlayground = lazy(() =>
  import('~/pages/settings/developers/playground/SettingsRestPlayground').then(
    (module) => ({
      default: module.SettingsRestPlayground,
    }),
  ),
);

export const SettingsAccountsCalendars = lazy(() =>
  import('~/pages/settings/accounts/SettingsAccountsCalendars').then(
    (module) => ({
      default: module.SettingsAccountsCalendars,
    }),
  ),
);

export const SettingsAccountsEmails = lazy(() =>
  import('~/pages/settings/accounts/SettingsAccountsEmails').then((module) => ({
    default: module.SettingsAccountsEmails,
  })),
);

export const SettingsAccountsConfiguration = lazy(() =>
  import('~/pages/settings/accounts/SettingsAccountsConfiguration').then(
    (module) => ({
      default: module.SettingsAccountsConfiguration,
    }),
  ),
);

export const SettingsNewAccount = lazy(() =>
  import('~/pages/settings/accounts/SettingsNewAccount').then((module) => ({
    default: module.SettingsNewAccount,
  })),
);

export const SettingsNewObject = lazy(() =>
  import('~/pages/settings/data-model/SettingsNewObject').then((module) => ({
    default: module.SettingsNewObject,
  })),
);

export const SettingsNewImapSmtpCaldavConnection = lazy(() =>
  import('@/settings/accounts/components/SettingsAccountsNewImapSmtpCaldavConnection').then(
    (module) => ({
      default: module.SettingsAccountsNewImapSmtpCaldavConnection,
    }),
  ),
);

export const SettingsEditImapSmtpCaldavConnection = lazy(() =>
  import('@/settings/accounts/components/SettingsAccountsEditImapSmtpCaldavConnection').then(
    (module) => ({
      default: module.SettingsAccountsEditImapSmtpCaldavConnection,
    }),
  ),
);

export const SettingsObjectDetailPage = lazy(() =>
  import('~/pages/settings/data-model/SettingsObjectDetailPage').then(
    (module) => ({
      default: module.SettingsObjectDetailPage,
    }),
  ),
);

export const SettingsObjectOverview = lazy(() =>
  import('~/pages/settings/data-model/SettingsObjectOverview').then(
    (module) => ({
      default: module.SettingsObjectOverview,
    }),
  ),
);

export const SettingsDevelopersApiKeyDetail = lazy(() =>
  import('~/pages/settings/developers/api-keys/SettingsDevelopersApiKeyDetail').then(
    (module) => ({
      default: module.SettingsDevelopersApiKeyDetail,
    }),
  ),
);

export const SettingsDevelopersApiKeysNew = lazy(() =>
  import('~/pages/settings/developers/api-keys/SettingsDevelopersApiKeysNew').then(
    (module) => ({
      default: module.SettingsDevelopersApiKeysNew,
    }),
  ),
);

export const SettingsLogicFunctionDetail = lazy(() =>
  import('~/pages/settings/logic-functions/SettingsLogicFunctionDetail').then(
    (module) => ({
      default: module.SettingsLogicFunctionDetail,
    }),
  ),
);

export const SettingsWorkspace = lazy(() =>
  import('~/pages/settings/SettingsWorkspace').then((module) => ({
    default: module.SettingsWorkspace,
  })),
);

export const SettingsDomains = lazy(() =>
  import('~/pages/settings/domains/SettingsDomains').then((module) => ({
    default: module.SettingsDomains,
  })),
);

export const SettingsSubdomainPage = lazy(() =>
  import('~/pages/settings/domains/SettingsSubdomainPage').then((module) => ({
    default: module.SettingsSubdomainPage,
  })),
);

export const SettingsCustomDomainPage = lazy(() =>
  import('~/pages/settings/domains/SettingsCustomDomainPage').then(
    (module) => ({
      default: module.SettingsCustomDomainPage,
    }),
  ),
);

export const SettingsApiWebhooks = lazy(() =>
  import('~/pages/settings/workspace/SettingsApiWebhooks').then((module) => ({
    default: module.SettingsApiWebhooks,
  })),
);

export const SettingsAI = lazy(() =>
  import('~/pages/settings/ai/SettingsAI').then((module) => ({
    default: module.SettingsAI,
  })),
);

export const SettingsAIUsageUserDetail = lazy(() =>
  import('~/pages/settings/ai/SettingsAIUsageUserDetail').then((module) => ({
    default: module.SettingsAIUsageUserDetail,
  })),
);

export const SettingsApplications = lazy(() =>
  import('~/pages/settings/applications/SettingsApplications').then(
    (module) => ({
      default: module.SettingsApplications,
    }),
  ),
);

export const SettingsApplicationDetails = lazy(() =>
  import('~/pages/settings/applications/SettingsApplicationDetails').then(
    (module) => ({
      default: module.SettingsApplicationDetails,
    }),
  ),
);

export const SettingsAvailableApplicationDetails = lazy(() =>
  import('~/pages/settings/applications/SettingsAvailableApplicationDetails').then(
    (module) => ({
      default: module.SettingsAvailableApplicationDetails,
    }),
  ),
);

export const SettingsApplicationRegistrationDetails = lazy(() =>
  import('~/pages/settings/applications/SettingsApplicationRegistrationDetails').then(
    (module) => ({
      default: module.SettingsApplicationRegistrationDetails,
    }),
  ),
);

export const SettingsAgentForm = lazy(() =>
  import('~/pages/settings/ai/SettingsAgentForm').then((module) => ({
    default: module.SettingsAgentForm,
  })),
);

export const SettingsAgentTurnDetail = lazy(() =>
  import('~/pages/settings/ai/SettingsAgentTurnDetail').then((module) => ({
    default: module.SettingsAgentTurnDetail,
  })),
);

export const SettingsSkillForm = lazy(() =>
  import('~/pages/settings/ai/SettingsSkillForm').then((module) => ({
    default: module.SettingsSkillForm,
  })),
);

export const SettingsAIPrompts = lazy(() =>
  import('~/pages/settings/ai/SettingsAIPrompts').then((module) => ({
    default: module.SettingsAIPrompts,
  })),
);

export const SettingsWorkspaceMembers = lazy(() =>
  import('~/pages/settings/members/SettingsWorkspaceMembers').then(
    (module) => ({
      default: module.SettingsWorkspaceMembers,
    }),
  ),
);

export const SettingsWorkspaceMember = lazy(() =>
  import('~/pages/settings/members/SettingsWorkspaceMember').then((module) => ({
    default: module.SettingsWorkspaceMember,
  })),
);

export const SettingsProfile = lazy(() =>
  import('~/pages/settings/SettingsProfile').then((module) => ({
    default: module.SettingsProfile,
  })),
);

export const SettingsTwoFactorAuthenticationMethod = lazy(() =>
  import('~/pages/settings/SettingsTwoFactorAuthenticationMethod').then(
    (module) => ({
      default: module.SettingsTwoFactorAuthenticationMethod,
    }),
  ),
);

export const SettingsExperience = lazy(() =>
  import('~/pages/settings/profile/appearance/components/SettingsExperience').then(
    (module) => ({
      default: module.SettingsExperience,
    }),
  ),
);

export const SettingsAboutExeCRM = lazy(() =>
  import('~/pages/settings/SettingsAboutExeCRM').then((module) => ({
    default: module.SettingsAboutExeCRM,
  })),
);

export const SettingsAccounts = lazy(() =>
  import('~/pages/settings/accounts/SettingsAccounts').then((module) => ({
    default: module.SettingsAccounts,
  })),
);

export const SettingsBilling = lazy(() =>
  import('~/pages/settings/SettingsBilling').then((module) => ({
    default: module.SettingsBilling,
  })),
);

export const SettingsUsage = lazy(() =>
  import('~/pages/settings/SettingsUsage').then((module) => ({
    default: module.SettingsUsage,
  })),
);

export const SettingsUsageUserDetail = lazy(() =>
  import('~/pages/settings/SettingsUsageUserDetail').then((module) => ({
    default: module.SettingsUsageUserDetail,
  })),
);

export const SettingsObjects = lazy(() =>
  import('~/pages/settings/data-model/SettingsObjects').then((module) => ({
    default: module.SettingsObjects,
  })),
);

export const SettingsDevelopersWebhookNew = lazy(() =>
  import('~/pages/settings/developers/webhooks/components/SettingsDevelopersWebhookNew').then(
    (module) => ({
      default: module.SettingsDevelopersWebhookNew,
    }),
  ),
);

export const SettingsDevelopersWebhookDetail = lazy(() =>
  import('~/pages/settings/developers/webhooks/components/SettingsDevelopersWebhookDetail').then(
    (module) => ({
      default: module.SettingsDevelopersWebhookDetail,
    }),
  ),
);

export const SettingsObjectNewFieldSelect = lazy(() =>
  import('~/pages/settings/data-model/new-field/SettingsObjectNewFieldSelect').then(
    (module) => ({
      default: module.SettingsObjectNewFieldSelect,
    }),
  ),
);

export const SettingsObjectNewFieldConfigure = lazy(() =>
  import('~/pages/settings/data-model/new-field/SettingsObjectNewFieldConfigure').then(
    (module) => ({
      default: module.SettingsObjectNewFieldConfigure,
    }),
  ),
);

export const SettingsObjectFieldEdit = lazy(() =>
  import('~/pages/settings/data-model/SettingsObjectFieldEdit').then(
    (module) => ({
      default: module.SettingsObjectFieldEdit,
    }),
  ),
);

export const SettingsSecurity = lazy(() =>
  import('~/pages/settings/security/SettingsSecurity').then((module) => ({
    default: module.SettingsSecurity,
  })),
);

export const SettingsSecuritySSOIdentifyProvider = lazy(() =>
  import('~/pages/settings/security/SettingsSecuritySSOIdentifyProvider').then(
    (module) => ({
      default: module.SettingsSecuritySSOIdentifyProvider,
    }),
  ),
);

export const SettingsSecurityApprovedAccessDomain = lazy(() =>
  import('~/pages/settings/security/SettingsSecurityApprovedAccessDomain').then(
    (module) => ({
      default: module.SettingsSecurityApprovedAccessDomain,
    }),
  ),
);

export const SettingsEventLogs = lazy(() =>
  import('~/pages/settings/security/event-logs/SettingsEventLogs').then(
    (module) => ({
      default: module.SettingsEventLogs,
    }),
  ),
);

export const SettingsNewEmailingDomain = lazy(() =>
  import('~/pages/settings/emailing-domains/SettingsNewEmailingDomain').then(
    (module) => ({
      default: module.SettingsNewEmailingDomain,
    }),
  ),
);

export const SettingsEmailingDomainDetail = lazy(() =>
  import('~/pages/settings/emailing-domains/SettingsEmailingDomainDetail').then(
    (module) => ({
      default: module.SettingsEmailingDomainDetail,
    }),
  ),
);

export const SettingsAdmin = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdmin').then((module) => ({
    default: module.SettingsAdmin,
  })),
);

export const SettingsAdminIndicatorHealthStatus = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminIndicatorHealthStatus').then(
    (module) => ({
      default: module.SettingsAdminIndicatorHealthStatus,
    }),
  ),
);

export const SettingsAdminQueueDetail = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminQueueDetail').then(
    (module) => ({
      default: module.SettingsAdminQueueDetail,
    }),
  ),
);

export const SettingsAdminConfigVariableDetails = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminConfigVariableDetails').then(
    (module) => ({
      default: module.SettingsAdminConfigVariableDetails,
    }),
  ),
);

export const SettingsAdminNewAiProvider = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminNewAiProvider').then(
    (module) => ({
      default: module.SettingsAdminNewAiProvider,
    }),
  ),
);

export const SettingsAdminAiProviderDetail = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminAiProviderDetail').then(
    (module) => ({
      default: module.SettingsAdminAiProviderDetail,
    }),
  ),
);

export const SettingsAdminNewAiModel = lazy(() =>
  import('~/pages/settings/admin-panel/SettingsAdminNewAiModel').then(
    (module) => ({
      default: module.SettingsAdminNewAiModel,
    }),
  ),
);

export const SettingsUpdates = lazy(() =>
  import('~/pages/settings/updates/SettingsUpdates').then((module) => ({
    default: module.SettingsUpdates,
  })),
);

export const SettingsRoles = lazy(() =>
  import('~/pages/settings/roles/SettingsRoles').then((module) => ({
    default: module.SettingsRoles,
  })),
);

export const SettingsRoleCreate = lazy(() =>
  import('~/pages/settings/roles/SettingsRoleCreate').then((module) => ({
    default: module.SettingsRoleCreate,
  })),
);

export const SettingsRoleEdit = lazy(() =>
  import('~/pages/settings/roles/SettingsRoleEdit').then((module) => ({
    default: module.SettingsRoleEdit,
  })),
);

export const SettingsRoleObjectLevel = lazy(() =>
  import('~/pages/settings/roles/SettingsRoleObjectLevel').then((module) => ({
    default: module.SettingsRoleObjectLevel,
  })),
);

export const SettingsRoleAddObjectLevel = lazy(() =>
  import('~/pages/settings/roles/SettingsRoleAddObjectLevel').then(
    (module) => ({
      default: module.SettingsRoleAddObjectLevel,
    }),
  ),
);
