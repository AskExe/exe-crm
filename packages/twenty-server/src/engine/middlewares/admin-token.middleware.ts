import { Injectable, type NestMiddleware } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type NextFunction, type Request, type Response } from 'express';
import { Repository } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class AdminTokenMiddleware implements NestMiddleware {
  private readonly adminToken: string | undefined;

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
  ) {
    this.adminToken = process.env.EXE_CRM_ADMIN_TOKEN;
  }

  async use(req: Request, _res: Response, next: NextFunction) {
    if (!this.adminToken) {
      next();

      return;
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      next();

      return;
    }

    const token = authHeader.slice(7);

    if (token !== this.adminToken) {
      next();

      return;
    }

    const workspace = await this.workspaceRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });

    if (!workspace) {
      next();

      return;
    }

    req.workspace = workspace as any;
    req.workspaceId = workspace.id;
    req.adminTokenAuthenticated = true;

    next();
  }
}
