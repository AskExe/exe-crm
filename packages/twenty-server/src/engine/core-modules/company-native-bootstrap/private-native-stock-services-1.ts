// Fixed stock graph only; no AppModule, HTTP, executable CRUD, auth or scheduler modules.
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { DataSourceService } from 'src/engine/metadata-modules/data-source/data-source.service';
import { EntitySchemaColumnFactory } from 'src/engine/twenty-orm/factories/entity-schema-column.factory';
import { EntitySchemaFactory } from 'src/engine/twenty-orm/factories/entity-schema.factory';
import { EntitySchemaRelationFactory } from 'src/engine/twenty-orm/factories/entity-schema-relation.factory';
import { EnvironmentConfigDriver } from 'src/engine/core-modules/twenty-config/drivers/environment-config.driver';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { FileStorageDriverFactory } from 'src/engine/core-modules/file-storage/file-storage-driver.factory';
import { FileStorageService } from 'src/engine/core-modules/file-storage/file-storage.service';
import { FlatAgentValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-agent-validator.service';
import { FlatCommandMenuItemValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-command-menu-item-validator.service';
import { FlatFieldMetadataTypeValidatorService } from 'src/engine/metadata-modules/flat-field-metadata/services/flat-field-metadata-type-validator.service';
import { FlatFieldMetadataValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-field-metadata-validator.service';
import { FlatFieldPermissionValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-field-permission-validator.service';
import { FlatFrontComponentValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-front-component-validator.service';
import { FlatIndexValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-index-metadata-validator.service';
import { FlatLogicFunctionValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-logic-function-validator.service';
import { FlatNavigationMenuItemValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-navigation-menu-item-validator.service';
import { FlatObjectMetadataValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-object-metadata-validator.service';
import { FlatObjectPermissionValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-object-permission-validator.service';
import { FlatPageLayoutTabValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-page-layout-tab-validator.service';
import { FlatPageLayoutValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-page-layout-validator.service';
import { FlatPageLayoutWidgetTypeValidatorService } from 'src/engine/metadata-modules/flat-page-layout-widget/services/flat-page-layout-widget-type-validator.service';
import { FlatPageLayoutWidgetValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-page-layout-widget-validator.service';
import { FlatPermissionFlagValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-permission-flag-validator.service';
import { FlatRoleTargetValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-role-target-validator.service';
import { FlatRoleValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-role-validator.service';
import { FlatRowLevelPermissionPredicateGroupValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-row-level-permission-predicate-group-validator.service';
import { FlatRowLevelPermissionPredicateValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-row-level-permission-predicate-validator.service';
import { FlatSkillValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-skill-validator.service';
import { FlatViewFieldGroupValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-field-group-validator.service';
import { FlatViewFieldValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-field-validator.service';
import { FlatViewFilterGroupValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-filter-group-validator.service';
import { FlatViewFilterValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-filter-validator.service';
import { FlatViewGroupValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-group-validator.service';
import { FlatViewSortValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-sort-validator.service';
import { FlatViewValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-validator.service';
import { FlatWebhookValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-webhook-validator.service';
import { GlobalWorkspaceDataSourceService } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-datasource.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { GqlTypeGenerator } from 'src/engine/api/graphql/workspace-schema-builder/graphql-type-generators/gql-type.generator';
import { LoggerService } from 'src/engine/core-modules/logger/logger.service';
import { LogicFunctionFromSourceHelperService } from 'src/engine/metadata-modules/logic-function/services/logic-function-from-source-helper.service';
import { LogicFunctionResourceService } from 'src/engine/core-modules/logic-function/logic-function-resource/logic-function-resource.service';
import { MetadataEventEmitter } from 'src/engine/subscriptions/metadata-event/metadata-event-emitter';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { RoleTargetService } from 'src/engine/metadata-modules/role-target/services/role-target.service';
import { ScalarsExplorerService } from 'src/engine/api/graphql/services/scalars-explorer.service';

export const PRIVATE_STOCK_SERVICES1 = Object.freeze([
  ApplicationService,
  CoreEntityCacheService,
  DataSourceService,
  EntitySchemaColumnFactory,
  EntitySchemaFactory,
  EntitySchemaRelationFactory,
  EnvironmentConfigDriver,
  FeatureFlagService,
  FileStorageDriverFactory,
  FileStorageService,
  FlatAgentValidatorService,
  FlatCommandMenuItemValidatorService,
  FlatFieldMetadataTypeValidatorService,
  FlatFieldMetadataValidatorService,
  FlatFieldPermissionValidatorService,
  FlatFrontComponentValidatorService,
  FlatIndexValidatorService,
  FlatLogicFunctionValidatorService,
  FlatNavigationMenuItemValidatorService,
  FlatObjectMetadataValidatorService,
  FlatObjectPermissionValidatorService,
  FlatPageLayoutTabValidatorService,
  FlatPageLayoutValidatorService,
  FlatPageLayoutWidgetTypeValidatorService,
  FlatPageLayoutWidgetValidatorService,
  FlatPermissionFlagValidatorService,
  FlatRoleTargetValidatorService,
  FlatRoleValidatorService,
  FlatRowLevelPermissionPredicateGroupValidatorService,
  FlatRowLevelPermissionPredicateValidatorService,
  FlatSkillValidatorService,
  FlatViewFieldGroupValidatorService,
  FlatViewFieldValidatorService,
  FlatViewFilterGroupValidatorService,
  FlatViewFilterValidatorService,
  FlatViewGroupValidatorService,
  FlatViewSortValidatorService,
  FlatViewValidatorService,
  FlatWebhookValidatorService,
  GlobalWorkspaceDataSourceService,
  GlobalWorkspaceOrmManager,
  GqlTypeGenerator,
  LoggerService,
  LogicFunctionFromSourceHelperService,
  LogicFunctionResourceService,
  MetadataEventEmitter,
  RoleService,
  RoleTargetService,
  ScalarsExplorerService,
]);
