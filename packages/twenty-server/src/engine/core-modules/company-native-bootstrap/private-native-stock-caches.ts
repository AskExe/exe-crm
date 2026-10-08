// Fixed stock graph only; no AppModule, HTTP, executable CRUD, auth or scheduler modules.
import { UserEntityCacheProviderService } from 'src/engine/core-modules/user/services/user-entity-cache-provider.service';
import { UserWorkspaceEntityCacheProviderService } from 'src/engine/core-modules/user-workspace/services/user-workspace-entity-cache-provider.service';
import { WorkspaceApplicationVariableMapCacheService } from 'src/engine/core-modules/application/application-variable/workspace-application-variable-map-cache.service';
import { WorkspaceEntityCacheProviderService } from 'src/engine/core-modules/workspace/services/workspace-entity-cache-provider.service';
import { WorkspaceFeatureFlagsMapCacheService } from 'src/engine/metadata-modules/workspace-feature-flags-map-cache/workspace-feature-flags-map-cache.service';
import { WorkspaceFlatAgentMapCacheService } from 'src/engine/metadata-modules/flat-agent/services/workspace-flat-agent-map-cache.service';
import { WorkspaceFlatApplicationMapCacheService } from 'src/engine/core-modules/application/workspace-flat-application-map-cache.service';
import { WorkspaceFlatCommandMenuItemMapCacheService } from 'src/engine/metadata-modules/flat-command-menu-item/services/workspace-flat-command-menu-item-map-cache.service';
import { WorkspaceFlatFieldMetadataMapCacheService } from 'src/engine/metadata-modules/flat-field-metadata/services/workspace-flat-field-metadata-map-cache.service';
import { WorkspaceFlatFieldPermissionMapCacheService } from 'src/engine/metadata-modules/flat-field-permission/services/workspace-flat-field-permission-map-cache.service';
import { WorkspaceFlatFrontComponentMapCacheService } from 'src/engine/metadata-modules/flat-front-component/services/workspace-flat-front-component-map-cache.service';
import { WorkspaceFlatIndexMapCacheService } from 'src/engine/metadata-modules/flat-index-metadata/services/workspace-flat-index-map-cache.service';
import { WorkspaceFlatLogicFunctionMapCacheService } from 'src/engine/metadata-modules/logic-function/services/workspace-flat-logic-function-map-cache.service';
import { WorkspaceFlatNavigationMenuItemMapCacheService } from 'src/engine/metadata-modules/flat-navigation-menu-item/services/workspace-flat-navigation-menu-item-map-cache.service';
import { WorkspaceFlatObjectMetadataMapCacheService } from 'src/engine/metadata-modules/flat-object-metadata/services/workspace-flat-object-metadata-map-cache.service';
import { WorkspaceFlatObjectPermissionMapCacheService } from 'src/engine/metadata-modules/flat-object-permission/services/workspace-flat-object-permission-map-cache.service';
import { WorkspaceFlatPageLayoutMapCacheService } from 'src/engine/metadata-modules/flat-page-layout/services/workspace-flat-page-layout-map-cache.service';
import { WorkspaceFlatPageLayoutTabMapCacheService } from 'src/engine/metadata-modules/flat-page-layout-tab/services/workspace-flat-page-layout-tab-map-cache.service';
import { WorkspaceFlatPageLayoutWidgetMapCacheService } from 'src/engine/metadata-modules/flat-page-layout-widget/services/workspace-flat-page-layout-widget-map-cache.service';
import { WorkspaceFlatPermissionFlagMapCacheService } from 'src/engine/metadata-modules/flat-permission-flag/services/workspace-flat-permission-flag-map-cache.service';
import { WorkspaceFlatRoleMapCacheService } from 'src/engine/metadata-modules/role/services/workspace-flat-role-map-cache.service';
import { WorkspaceFlatRoleTargetMapCacheService } from 'src/engine/metadata-modules/flat-role-target/services/workspace-flat-role-target-map-cache.service';
import { WorkspaceFlatRowLevelPermissionPredicateGroupMapCacheService } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/services/workspace-flat-row-level-permission-predicate-group-map-cache.service';
import { WorkspaceFlatRowLevelPermissionPredicateMapCacheService } from 'src/engine/metadata-modules/flat-row-level-permission-predicate/services/workspace-flat-row-level-permission-predicate-map-cache.service';
import { WorkspaceFlatSkillMapCacheService } from 'src/engine/metadata-modules/flat-skill/services/workspace-flat-skill-map-cache.service';
import { WorkspaceFlatViewFieldGroupMapCacheService } from 'src/engine/metadata-modules/flat-view-field-group/services/workspace-flat-view-field-group-map-cache.service';
import { WorkspaceFlatViewFieldMapCacheService } from 'src/engine/metadata-modules/flat-view-field/services/workspace-flat-view-field-map-cache.service';
import { WorkspaceFlatViewFilterGroupMapCacheService } from 'src/engine/metadata-modules/flat-view-filter-group/services/workspace-flat-view-filter-group-map-cache.service';
import { WorkspaceFlatViewFilterMapCacheService } from 'src/engine/metadata-modules/flat-view-filter/services/workspace-flat-view-filter-map-cache.service';
import { WorkspaceFlatViewGroupMapCacheService } from 'src/engine/metadata-modules/flat-view-group/services/workspace-flat-view-group-map-cache.service';
import { WorkspaceFlatViewMapCacheService } from 'src/engine/metadata-modules/flat-view/services/workspace-flat-view-map-cache.service';
import { WorkspaceFlatViewSortMapCacheService } from 'src/engine/metadata-modules/flat-view-sort/services/workspace-flat-view-sort-map-cache.service';
import { WorkspaceFlatWebhookMapCacheService } from 'src/engine/metadata-modules/flat-webhook/services/workspace-flat-webhook-map-cache.service';
import { WorkspaceFlatWorkspaceMemberMapCacheService } from 'src/engine/core-modules/user/services/workspace-flat-workspace-member-map-cache.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { WorkspaceORMEntityMetadatasCacheService } from 'src/engine/twenty-orm/global-workspace-datasource/workspace-orm-entity-metadatas-cache.service';
import { WorkspaceRolesPermissionsCacheService } from 'src/engine/metadata-modules/role/services/workspace-roles-permissions-cache.service';
import { WorkspaceUserWorkspaceRoleMapCacheService } from 'src/engine/metadata-modules/role-target/services/workspace-user-workspace-role-map-cache.service';

export const PRIVATE_STOCK_CACHES = Object.freeze([
  UserEntityCacheProviderService,
  UserWorkspaceEntityCacheProviderService,
  WorkspaceApplicationVariableMapCacheService,
  WorkspaceEntityCacheProviderService,
  WorkspaceFeatureFlagsMapCacheService,
  WorkspaceFlatAgentMapCacheService,
  WorkspaceFlatApplicationMapCacheService,
  WorkspaceFlatCommandMenuItemMapCacheService,
  WorkspaceFlatFieldMetadataMapCacheService,
  WorkspaceFlatFieldPermissionMapCacheService,
  WorkspaceFlatFrontComponentMapCacheService,
  WorkspaceFlatIndexMapCacheService,
  WorkspaceFlatLogicFunctionMapCacheService,
  WorkspaceFlatNavigationMenuItemMapCacheService,
  WorkspaceFlatObjectMetadataMapCacheService,
  WorkspaceFlatObjectPermissionMapCacheService,
  WorkspaceFlatPageLayoutMapCacheService,
  WorkspaceFlatPageLayoutTabMapCacheService,
  WorkspaceFlatPageLayoutWidgetMapCacheService,
  WorkspaceFlatPermissionFlagMapCacheService,
  WorkspaceFlatRoleMapCacheService,
  WorkspaceFlatRoleTargetMapCacheService,
  WorkspaceFlatRowLevelPermissionPredicateGroupMapCacheService,
  WorkspaceFlatRowLevelPermissionPredicateMapCacheService,
  WorkspaceFlatSkillMapCacheService,
  WorkspaceFlatViewFieldGroupMapCacheService,
  WorkspaceFlatViewFieldMapCacheService,
  WorkspaceFlatViewFilterGroupMapCacheService,
  WorkspaceFlatViewFilterMapCacheService,
  WorkspaceFlatViewGroupMapCacheService,
  WorkspaceFlatViewMapCacheService,
  WorkspaceFlatViewSortMapCacheService,
  WorkspaceFlatWebhookMapCacheService,
  WorkspaceFlatWorkspaceMemberMapCacheService,
  WorkspaceManyOrAllFlatEntityMapsCacheService,
  WorkspaceORMEntityMetadatasCacheService,
  WorkspaceRolesPermissionsCacheService,
  WorkspaceUserWorkspaceRoleMapCacheService,
]);
