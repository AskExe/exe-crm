import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';
import { ApplicationRegistrationVariableEntity } from 'src/engine/core-modules/application/application-registration-variable/application-registration-variable.entity';
import { ApplicationVariableEntity } from 'src/engine/core-modules/application/application-variable/application-variable.entity';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { ApprovedAccessDomainEntity } from 'src/engine/core-modules/approved-access-domain/approved-access-domain.entity';
import { DataProvenanceEntity } from 'src/engine/core-modules/data-ingestion/data-provenance.entity';
import { EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import { FeatureFlagEntity } from 'src/engine/core-modules/feature-flag/feature-flag.entity';
import { FieldAuditLogEntity } from 'src/engine/core-modules/field-audit/field-audit.entity';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { PostgresCredentialsEntity } from 'src/engine/core-modules/postgres-credentials/postgres-credentials.entity';
import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { WorkspaceSSOIdentityProviderEntity } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';
import { TwoFactorAuthenticationMethodEntity } from 'src/engine/core-modules/two-factor-authentication/entities/two-factor-authentication-method.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { AgentMessagePartEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message-part.entity';
import { AgentMessageEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-message.entity';
import { AgentTurnEntity } from 'src/engine/metadata-modules/ai/ai-agent-execution/entities/agent-turn.entity';
import { AgentTurnEvaluationEntity } from 'src/engine/metadata-modules/ai/ai-agent-monitor/entities/agent-turn-evaluation.entity';
import { AgentChatThreadEntity } from 'src/engine/metadata-modules/ai/ai-chat/entities/agent-chat-thread.entity';
import { CalendarChannelEntity } from 'src/engine/metadata-modules/calendar-channel/entities/calendar-channel.entity';
import { CommandMenuItemEntity } from 'src/engine/metadata-modules/command-menu-item/entities/command-menu-item.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { DataSourceEntity } from 'src/engine/metadata-modules/data-source/data-source.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FrontComponentEntity } from 'src/engine/metadata-modules/front-component/entities/front-component.entity';
import { IndexFieldMetadataEntity } from 'src/engine/metadata-modules/index-metadata/index-field-metadata.entity';
import { IndexMetadataEntity } from 'src/engine/metadata-modules/index-metadata/index-metadata.entity';
import { LogicFunctionEntity } from 'src/engine/metadata-modules/logic-function/logic-function.entity';
import { LogicFunctionLayerEntity } from 'src/engine/metadata-modules/logic-function-layer/logic-function-layer.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';
import { NavigationMenuItemEntity } from 'src/engine/metadata-modules/navigation-menu-item/entities/navigation-menu-item.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { PageLayoutEntity } from 'src/engine/metadata-modules/page-layout/entities/page-layout.entity';
import { PageLayoutTabEntity } from 'src/engine/metadata-modules/page-layout-tab/entities/page-layout-tab.entity';
import { PageLayoutWidgetEntity } from 'src/engine/metadata-modules/page-layout-widget/entities/page-layout-widget.entity';
import { PermissionFlagEntity } from 'src/engine/metadata-modules/permission-flag/permission-flag.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { SearchFieldMetadataEntity } from 'src/engine/metadata-modules/search-field-metadata/search-field-metadata.entity';
import { SkillEntity } from 'src/engine/metadata-modules/skill/entities/skill.entity';
import { ViewEntity } from 'src/engine/metadata-modules/view/entities/view.entity';
import { ViewFieldEntity } from 'src/engine/metadata-modules/view-field/entities/view-field.entity';
import { ViewFieldGroupEntity } from 'src/engine/metadata-modules/view-field-group/entities/view-field-group.entity';
import { ViewFilterEntity } from 'src/engine/metadata-modules/view-filter/entities/view-filter.entity';
import { ViewFilterGroupEntity } from 'src/engine/metadata-modules/view-filter-group/entities/view-filter-group.entity';
import { ViewGroupEntity } from 'src/engine/metadata-modules/view-group/entities/view-group.entity';
import { ViewSortEntity } from 'src/engine/metadata-modules/view-sort/entities/view-sort.entity';
import { WebhookEntity } from 'src/engine/metadata-modules/webhook/entities/webhook.entity';

// Exact native billing-disabled entity graph; not table privileges or authority.
// No ambient .env, filesystem globs, migrations or synchronization are loaded.
export const PRIVATE_NATIVE_STOCK_ENTITIES = Object.freeze([
  ApiKeyEntity,
  AppTokenEntity,
  ApplicationRegistrationEntity,
  ApplicationRegistrationVariableEntity,
  ApplicationVariableEntity,
  ApplicationEntity,
  ApprovedAccessDomainEntity,
  DataProvenanceEntity,
  EmailingDomainEntity,
  FeatureFlagEntity,
  FieldAuditLogEntity,
  FileEntity,
  KeyValuePairEntity,
  PostgresCredentialsEntity,
  PublicDomainEntity,
  WorkspaceSSOIdentityProviderEntity,
  TwoFactorAuthenticationMethodEntity,
  UserEntity,
  UserWorkspaceEntity,
  WorkspaceEntity,
  AgentEntity,
  AgentMessagePartEntity,
  AgentMessageEntity,
  AgentTurnEntity,
  AgentTurnEvaluationEntity,
  AgentChatThreadEntity,
  CalendarChannelEntity,
  CommandMenuItemEntity,
  ConnectedAccountEntity,
  DataSourceEntity,
  FieldMetadataEntity,
  FrontComponentEntity,
  IndexFieldMetadataEntity,
  IndexMetadataEntity,
  LogicFunctionEntity,
  LogicFunctionLayerEntity,
  MessageChannelEntity,
  MessageFolderEntity,
  NavigationMenuItemEntity,
  ObjectMetadataEntity,
  FieldPermissionEntity,
  ObjectPermissionEntity,
  PageLayoutEntity,
  PageLayoutTabEntity,
  PageLayoutWidgetEntity,
  PermissionFlagEntity,
  RoleEntity,
  RoleTargetEntity,
  RowLevelPermissionPredicateGroupEntity,
  RowLevelPermissionPredicateEntity,
  SearchFieldMetadataEntity,
  SkillEntity,
  ViewEntity,
  ViewFieldEntity,
  ViewFieldGroupEntity,
  ViewFilterEntity,
  ViewFilterGroupEntity,
  ViewGroupEntity,
  ViewSortEntity,
  WebhookEntity,
]);
