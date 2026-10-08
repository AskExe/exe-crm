// Fixed stock graph only; no AppModule, HTTP, executable CRUD, auth or scheduler modules.
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { TwentyStandardApplicationService } from 'src/engine/workspace-manager/twenty-standard-application/services/twenty-standard-application.service';
import { TypeMapperService } from 'src/engine/api/graphql/workspace-schema-builder/services/type-mapper.service';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceDataSourceService } from 'src/engine/workspace-datasource/workspace-datasource.service';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { WorkspaceFlatRoleTargetByAgentIdService } from 'src/engine/metadata-modules/flat-agent/services/workspace-flat-role-target-by-agent-id.service';
import { WorkspaceGraphQLSchemaGenerator } from 'src/engine/api/graphql/workspace-schema-builder/workspace-graphql-schema.factory';
import { WorkspaceManagerService } from 'src/engine/workspace-manager/workspace-manager.service';
import { WorkspaceMetadataVersionService } from 'src/engine/metadata-modules/workspace-metadata-version/services/workspace-metadata-version.service';
import { WorkspaceMigrationAgentActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/agent/workspace-migration-agent-actions-builder.service';
import { WorkspaceMigrationBuildOrchestratorService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-build-orchestrator.service';
import { WorkspaceMigrationCommandMenuItemActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/command-menu-item/workspace-migration-command-menu-item-actions-builder.service';
import { WorkspaceMigrationFieldActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/field/workspace-migration-field-actions-builder.service';
import { WorkspaceMigrationFieldPermissionActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/field-permission/workspace-migration-field-permission-actions-builder.service';
import { WorkspaceMigrationFrontComponentActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/front-component/workspace-migration-front-component-actions-builder.service';
import { WorkspaceMigrationIndexActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/index/workspace-migration-index-actions-builder.service';
import { WorkspaceMigrationLogicFunctionActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/logic-function/workspace-migration-logic-function-actions-builder.service';
import { WorkspaceMigrationNavigationMenuItemActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/navigation-menu-item/workspace-migration-navigation-menu-item-actions-builder.service';
import { WorkspaceMigrationObjectActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/object/workspace-migration-object-actions-builder.service';
import { WorkspaceMigrationObjectPermissionActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/object-permission/workspace-migration-object-permission-actions-builder.service';
import { WorkspaceMigrationPageLayoutActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/page-layout/workspace-migration-page-layout-actions-builder.service';
import { WorkspaceMigrationPageLayoutTabActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/page-layout-tab/workspace-migration-page-layout-tab-actions-builder.service';
import { WorkspaceMigrationPageLayoutWidgetActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/page-layout-widget/workspace-migration-page-layout-widget-actions-builder.service';
import { WorkspaceMigrationPermissionFlagActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/permission-flag/workspace-migration-permission-flag-actions-builder.service';
import { WorkspaceMigrationRoleActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/role/workspace-migration-role-actions-builder.service';
import { WorkspaceMigrationRoleTargetActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/role-target/workspace-migration-role-target-actions-builder.service';
import { WorkspaceMigrationRowLevelPermissionPredicateActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate/workspace-migration-row-level-permission-predicate-actions-builder.service';
import { WorkspaceMigrationRowLevelPermissionPredicateGroupActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/row-level-permission-predicate-group/workspace-migration-row-level-permission-predicate-group-actions-builder.service';
import { WorkspaceMigrationRunnerActionHandlerRegistryService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/registry/workspace-migration-runner-action-handler-registry.service';
import { WorkspaceMigrationRunnerService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/workspace-migration-runner.service';
import { WorkspaceMigrationSkillActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/skill/workspace-migration-skill-actions-builder.service';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { WorkspaceMigrationViewActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view/workspace-migration-view-actions-builder.service';
import { WorkspaceMigrationViewFieldActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-field/workspace-migration-view-field-actions-builder.service';
import { WorkspaceMigrationViewFieldGroupActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-field-group/workspace-migration-view-field-group-actions-builder.service';
import { WorkspaceMigrationViewFilterActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-filter/workspace-migration-view-filter-actions-builder.service';
import { WorkspaceMigrationViewFilterGroupActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-filter-group/workspace-migration-view-filter-group-actions-builder.service';
import { WorkspaceMigrationViewGroupActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-group/workspace-migration-view-group-actions-builder.service';
import { WorkspaceMigrationViewSortActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/view-sort/workspace-migration-view-sort-actions.builder.service';
import { WorkspaceMigrationWebhookActionsBuilderService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/builders/webhook/workspace-migration-webhook-actions-builder.service';
import { WorkspaceResolverBuilderService } from 'src/engine/api/graphql/workspace-resolver-builder/workspace-resolver-builder.service';
import { WorkspaceSchemaColumnManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/services/workspace-schema-column-manager.service';
import { WorkspaceSchemaEnumManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/services/workspace-schema-enum-manager.service';
import { WorkspaceSchemaForeignKeyManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/services/workspace-schema-foreign-key-manager.service';
import { WorkspaceSchemaIndexManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/services/workspace-schema-index-manager.service';
import { WorkspaceSchemaManagerService } from '/private/tmp/askexe-staging-20261008/company-crm-stock-phase/exe-crm/packages/twenty-server/src/engine/twenty-orm/workspace-schema-manager/workspace-schema-manager.service';
import { WorkspaceSchemaTableManagerService } from 'src/engine/twenty-orm/workspace-schema-manager/services/workspace-schema-table-manager.service';

export const PRIVATE_STOCK_SERVICES2 = Object.freeze([
  TwentyConfigService,
  TwentyStandardApplicationService,
  TypeMapperService,
  UserRoleService,
  WorkspaceCacheService,
  WorkspaceCacheStorageService,
  WorkspaceDataSourceService,
  WorkspaceEventEmitter,
  WorkspaceFlatRoleTargetByAgentIdService,
  WorkspaceGraphQLSchemaGenerator,
  WorkspaceManagerService,
  WorkspaceMetadataVersionService,
  WorkspaceMigrationAgentActionsBuilderService,
  WorkspaceMigrationBuildOrchestratorService,
  WorkspaceMigrationCommandMenuItemActionsBuilderService,
  WorkspaceMigrationFieldActionsBuilderService,
  WorkspaceMigrationFieldPermissionActionsBuilderService,
  WorkspaceMigrationFrontComponentActionsBuilderService,
  WorkspaceMigrationIndexActionsBuilderService,
  WorkspaceMigrationLogicFunctionActionsBuilderService,
  WorkspaceMigrationNavigationMenuItemActionsBuilderService,
  WorkspaceMigrationObjectActionsBuilderService,
  WorkspaceMigrationObjectPermissionActionsBuilderService,
  WorkspaceMigrationPageLayoutActionsBuilderService,
  WorkspaceMigrationPageLayoutTabActionsBuilderService,
  WorkspaceMigrationPageLayoutWidgetActionsBuilderService,
  WorkspaceMigrationPermissionFlagActionsBuilderService,
  WorkspaceMigrationRoleActionsBuilderService,
  WorkspaceMigrationRoleTargetActionsBuilderService,
  WorkspaceMigrationRowLevelPermissionPredicateActionsBuilderService,
  WorkspaceMigrationRowLevelPermissionPredicateGroupActionsBuilderService,
  WorkspaceMigrationRunnerActionHandlerRegistryService,
  WorkspaceMigrationRunnerService,
  WorkspaceMigrationSkillActionsBuilderService,
  WorkspaceMigrationValidateBuildAndRunService,
  WorkspaceMigrationViewActionsBuilderService,
  WorkspaceMigrationViewFieldActionsBuilderService,
  WorkspaceMigrationViewFieldGroupActionsBuilderService,
  WorkspaceMigrationViewFilterActionsBuilderService,
  WorkspaceMigrationViewFilterGroupActionsBuilderService,
  WorkspaceMigrationViewGroupActionsBuilderService,
  WorkspaceMigrationViewSortActionsBuilderService,
  WorkspaceMigrationWebhookActionsBuilderService,
  WorkspaceResolverBuilderService,
  WorkspaceSchemaColumnManagerService,
  WorkspaceSchemaEnumManagerService,
  WorkspaceSchemaForeignKeyManagerService,
  WorkspaceSchemaIndexManagerService,
  WorkspaceSchemaManagerService,
  WorkspaceSchemaTableManagerService,
]);
