import { Body, Controller, Post, UseFilters, UseGuards } from '@nestjs/common';

import { RestApiExceptionFilter } from 'src/engine/api/rest/rest-api-exception.filter';
import {
  IngestDataDto,
  type IngestResult,
} from 'src/engine/core-modules/data-ingestion/data-ingestion.dto';
import { DataIngestionService } from 'src/engine/core-modules/data-ingestion/data-ingestion.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

// NoPermissionGuard: ingestion is a workspace-scoped self-service write —
// JwtAuthGuard + WorkspaceAuthGuard establish the caller's workspace, and the
// service only writes provenance rows for that same workspace (no
// cross-workspace access, no settings surface), so no additional permission
// applies.
@Controller('api')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard, NoPermissionGuard)
@UseFilters(RestApiExceptionFilter)
export class DataIngestionController {
  constructor(private readonly dataIngestionService: DataIngestionService) {}

  @Post('ingest')
  async ingest(
    @Body() body: IngestDataDto,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<IngestResult> {
    return this.dataIngestionService.ingestRecords(
      workspace.id,
      body.records,
      body.source,
      // userId will come from the auth context in production;
      // using workspace.id as placeholder for system-level ingestion
      workspace.id,
    );
  }
}
