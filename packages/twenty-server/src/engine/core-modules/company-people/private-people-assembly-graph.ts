import { WorkspaceFeatureFlagsMapCacheService } from 'src/engine/metadata-modules/workspace-feature-flags-map-cache/workspace-feature-flags-map-cache.service';
import { WorkspaceFlatRowLevelPermissionPredicateGroupMapCacheService } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/services/workspace-flat-row-level-permission-predicate-group-map-cache.service';
import { WorkspaceFlatRowLevelPermissionPredicateMapCacheService } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/services/workspace-flat-row-level-permission-predicate-map-cache.service';
import { WorkspaceFlatFieldMetadataMapCacheService } from 'src/engine/metadata-modules/flat-field-metadata/services/workspace-flat-field-metadata-map-cache.service';
import { WorkspaceFlatObjectMetadataMapCacheService } from 'src/engine/metadata-modules/flat-object-metadata/services/workspace-flat-object-metadata-map-cache.service';
import { WorkspaceUserWorkspaceRoleMapCacheService } from 'src/engine/metadata-modules/role-target/services/workspace-user-workspace-role-map-cache.service';
import { WorkspaceApiKeyRoleMapCacheService } from 'src/engine/metadata-modules/role-target/services/workspace-api-key-role-map-cache.service';
import { WorkspaceFlatIndexMapCacheService } from 'src/engine/metadata-modules/flat-index-metadata/services/workspace-flat-index-map-cache.service';
import { WorkspaceRolesPermissionsCacheService } from 'src/engine/metadata-modules/role/services/workspace-roles-permissions-cache.service';
import { WorkspaceORMEntityMetadatasCacheService } from 'src/engine/twenty-orm/global-workspace-datasource/workspace-orm-entity-metadatas-cache.service';
import { AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { ApplicationRegistrationEntity } from 'src/engine/core-modules/application/application-registration/application-registration.entity';
import { ApplicationRegistrationVariableEntity } from 'src/engine/core-modules/application/application-registration-variable/application-registration-variable.entity';
import { ApplicationVariableEntity } from 'src/engine/core-modules/application/application-variable/application-variable.entity';
import { ApprovedAccessDomainEntity } from 'src/engine/core-modules/approved-access-domain/approved-access-domain.entity';
import { DataSourceEntity } from 'src/engine/metadata-modules/data-source/data-source.entity';
import { EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import { FeatureFlagEntity } from 'src/engine/core-modules/feature-flag/feature-flag.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FieldPermissionEntity } from 'src/engine/metadata-modules/object-permission/field-permission/field-permission.entity';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { IndexFieldMetadataEntity } from 'src/engine/metadata-modules/index-metadata/index-field-metadata.entity';
import { IndexMetadataEntity } from 'src/engine/metadata-modules/index-metadata/index-metadata.entity';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { LogicFunctionEntity } from 'src/engine/metadata-modules/logic-function/logic-function.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { ObjectPermissionEntity } from 'src/engine/metadata-modules/object-permission/object-permission.entity';
import { PermissionFlagEntity } from 'src/engine/metadata-modules/permission-flag/permission-flag.entity';
import { PostgresCredentialsEntity } from 'src/engine/core-modules/postgres-credentials/postgres-credentials.entity';
import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { RowLevelPermissionPredicateEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate.entity';
import { RowLevelPermissionPredicateGroupEntity } from 'src/engine/metadata-modules/row-level-permission-predicate/entities/row-level-permission-predicate-group.entity';
import { TwoFactorAuthenticationMethodEntity } from 'src/engine/core-modules/two-factor-authentication/entities/two-factor-authentication-method.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ViewEntity } from 'src/engine/metadata-modules/view/entities/view.entity';
import { ViewFieldEntity } from 'src/engine/metadata-modules/view-field/entities/view-field.entity';
import { ViewFieldGroupEntity } from 'src/engine/metadata-modules/view-field-group/entities/view-field-group.entity';
import { ViewFilterEntity } from 'src/engine/metadata-modules/view-filter/entities/view-filter.entity';
import { ViewFilterGroupEntity } from 'src/engine/metadata-modules/view-filter-group/entities/view-filter-group.entity';
import { ViewGroupEntity } from 'src/engine/metadata-modules/view-group/entities/view-group.entity';
import { ViewSortEntity } from 'src/engine/metadata-modules/view-sort/entities/view-sort.entity';
import { WebhookEntity } from 'src/engine/metadata-modules/webhook/entities/webhook.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceSSOIdentityProviderEntity } from 'src/engine/core-modules/sso/workspace-sso-identity-provider.entity';

// Exact reviewed Source-literal relation closure. No broad feature modules.
export const PRIVATE_PEOPLE_METADATA_ENTITIES = [
  AgentEntity,
  ApiKeyEntity,
  AppTokenEntity,
  ApplicationEntity,
  ApplicationRegistrationEntity,
  ApplicationRegistrationVariableEntity,
  ApplicationVariableEntity,
  ApprovedAccessDomainEntity,
  DataSourceEntity,
  EmailingDomainEntity,
  FeatureFlagEntity,
  FieldMetadataEntity,
  FieldPermissionEntity,
  FileEntity,
  IndexFieldMetadataEntity,
  IndexMetadataEntity,
  KeyValuePairEntity,
  LogicFunctionEntity,
  ObjectMetadataEntity,
  ObjectPermissionEntity,
  PermissionFlagEntity,
  PostgresCredentialsEntity,
  PublicDomainEntity,
  RoleEntity,
  RoleTargetEntity,
  RowLevelPermissionPredicateEntity,
  RowLevelPermissionPredicateGroupEntity,
  TwoFactorAuthenticationMethodEntity,
  UserEntity,
  UserWorkspaceEntity,
  ViewEntity,
  ViewFieldEntity,
  ViewFieldGroupEntity,
  ViewFilterEntity,
  ViewFilterGroupEntity,
  ViewGroupEntity,
  ViewSortEntity,
  WebhookEntity,
  WorkspaceEntity,
  WorkspaceSSOIdentityProviderEntity,
];
export const PRIVATE_PEOPLE_CACHE_PROVIDERS = [
  WorkspaceFeatureFlagsMapCacheService,
  WorkspaceFlatRowLevelPermissionPredicateGroupMapCacheService,
  WorkspaceFlatRowLevelPermissionPredicateMapCacheService,
  WorkspaceFlatFieldMetadataMapCacheService,
  WorkspaceFlatObjectMetadataMapCacheService,
  WorkspaceUserWorkspaceRoleMapCacheService,
  WorkspaceApiKeyRoleMapCacheService,
  WorkspaceFlatIndexMapCacheService,
  WorkspaceRolesPermissionsCacheService,
  WorkspaceORMEntityMetadatasCacheService,
];
