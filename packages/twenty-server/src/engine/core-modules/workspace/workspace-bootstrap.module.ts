import { Module } from '@nestjs/common';

import { WorkspaceBootstrapService } from 'src/engine/core-modules/workspace/services/workspace-bootstrap.service';

/**
 * WorkspaceBootstrapService lives in its own module so HealthModule can read the
 * bootstrap outcome without importing all of WorkspaceModule (which would pull
 * the metadata/permissions graph into the readiness probe and risk a cycle).
 *
 * It has no imports of its own — the default DataSource token is global — so it
 * is safe to import from anywhere. Registered here ONLY: WorkspaceModule imports
 * this module rather than providing the service, so there is exactly one
 * instance and therefore exactly one onModuleInit and one failure state.
 */
@Module({
  providers: [WorkspaceBootstrapService],
  exports: [WorkspaceBootstrapService],
})
export class WorkspaceBootstrapModule {}
