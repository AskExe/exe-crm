import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from 'src/engine/core-modules/health/controllers/health.controller';
import { WorkspaceBootstrapModule } from 'src/engine/core-modules/workspace/workspace-bootstrap.module';

@Module({
  imports: [TerminusModule, WorkspaceBootstrapModule],
  controllers: [HealthController],
})
export class HealthModule {}
