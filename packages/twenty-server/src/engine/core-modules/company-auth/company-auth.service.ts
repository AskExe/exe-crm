import { createHash } from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { type Request } from 'express';
import { DataSource, IsNull } from 'typeorm';

import { type RawAuthContext } from 'src/engine/core-modules/auth/types/auth-context.type';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { fromUserWorkspaceEntityToFlat } from 'src/engine/core-modules/user-workspace/utils/from-user-workspace-entity-to-flat.util';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { fromWorkspaceEntityToFlat } from 'src/engine/core-modules/workspace/utils/from-workspace-entity-to-flat.util';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { readCompanyAuthConfiguration } from './company-auth.config';
import { companyCredential, companySubject } from './company-auth.policy';
import { companyMemberToFlat } from './company-member-to-flat';

@Injectable()
export class CompanyAuthService {
  readonly configuration = readCompanyAuthConfiguration();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workspaceCacheService: WorkspaceCacheService,
  ) {}

  async authenticate(
    request: Request,
    signal?: AbortSignal,
  ): Promise<RawAuthContext> {
    try {
      signal?.throwIfAborted();
      const context = await this.currentNativeContext(request, signal);
      signal?.throwIfAborted();
      return context;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Never expose provider payloads, identifiers or credentials to logs/errors.
      throw new ServiceUnavailableException(
        'Company authorization unavailable',
      );
    }
  }

  async currentRead(request: Request, signal: AbortSignal) {
    const context = await this.authenticate(request, signal);
    if (
      !context.workspace ||
      !context.user ||
      !context.userWorkspaceId ||
      !context.workspaceMember ||
      !context.workspaceMemberId
    )
      throw new UnauthorizedException('Company authorization denied');
    try {
      const permissions = await this.workspaceCacheService.getOrRecompute(
        context.workspace.id,
        [
          'rolesPermissions',
          'userWorkspaceRoleMap',
          'flatRowLevelPermissionPredicateMaps',
          'flatRowLevelPermissionPredicateGroupMaps',
          'flatFieldMetadataMaps',
        ],
      );
      signal.throwIfAborted();
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            user: context.user.id,
            workspace: context.workspace.id,
            member: context.workspaceMember,
            userWorkspace: context.userWorkspace,
            permissions,
          }),
        )
        .digest('hex');
      return { context, fingerprint };
    } catch {
      throw new ServiceUnavailableException(
        'Company permission authority unavailable',
      );
    }
  }

  async authenticateSessionToken(token: string, signal: AbortSignal): Promise<RawAuthContext> {
    if (!/^exs_[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Company authorization denied');
    try {
      signal.throwIfAborted();
      const context = await this.currentCredentialContext({ kind: 'session', value: token }, signal);
      signal.throwIfAborted();
      return context;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('Company authorization unavailable');
    }
  }

  private async currentNativeContext(
    request: Request,
    signal?: AbortSignal,
  ): Promise<RawAuthContext> {
    const config = this.configuration;

    if (!config)
      throw new UnauthorizedException('Company authorization denied');
    let credential;
    try {
      credential = companyCredential(request);
    } catch {
      throw new UnauthorizedException('Company authorization denied');
    }
    return this.currentCredentialContext(credential, signal);
  }

  private async currentCredentialContext(
    credential: { kind: 'key' | 'session'; value: string },
    signal?: AbortSignal,
  ): Promise<RawAuthContext> {
    const config = this.configuration;
    if (!config) throw new UnauthorizedException('Company authorization denied');
    const response = await fetch(
      credential.kind === 'key'
        ? config.authorityUrl + '/internal/company-authority/key-introspect'
        : config.brokerUrl + '/internal/session-broker/introspect',
      {
        method: 'POST',
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            'Basic ' +
            Buffer.from(config.clientId + ':' + config.clientSecret).toString(
              'base64',
            ),
        },
        body: JSON.stringify(
          credential.kind === 'key'
            ? { api_key: credential.value }
            : { session_token: credential.value },
        ),
      },
    );

    if (response.status === 400)
      throw new BadRequestException('Company authorization invalid');
    if (response.status === 401 || response.status === 403)
      throw new UnauthorizedException('Company authorization denied');
    if (response.status !== 200 || !response.body)
      throw new ServiceUnavailableException(
        'Company authorization unavailable',
      );
    const reader = response.body.getReader();
    let body = '';
    let bytes = 0;

    try {
      while (true) {
        const chunk = await reader.read();

        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384)
          throw new UnauthorizedException('Company authorization denied');
        body += Buffer.from(chunk.value).toString('utf8');
      }
    } finally {
      await reader.cancel();
    }
    let subject: string;
    const value: unknown = JSON.parse(body);
    try {
      subject = companySubject(value, config);
    } catch {
      throw new UnauthorizedException('Company authorization denied');
    }
    const binding = config.bindings.get(subject);

    if (!binding)
      throw new UnauthorizedException('Company authorization denied');
    // Identity queries occur AFTER current authority, including a blocked lookup.
    const workspace = await this.dataSource
      .getRepository(WorkspaceEntity)
      .findOne({
        where: { id: config.workspaceId, deletedAt: IsNull() },
      });
    const user = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id: binding.user_id, deletedAt: IsNull() },
    });
    const userWorkspace = await this.dataSource
      .getRepository(UserWorkspaceEntity)
      .findOne({
        where: {
          id: binding.user_workspace_id,
          userId: binding.user_id,
          workspaceId: config.workspaceId,
          deletedAt: IsNull(),
        },
      });
    const roleTarget = await this.dataSource
      .getRepository(RoleTargetEntity)
      .findOne({
        where: {
          workspaceId: config.workspaceId,
          userWorkspaceId: binding.user_workspace_id,
        },
        relations: { role: true },
      });

    if (
      !workspace ||
      workspace.activationStatus !== 'ACTIVE' ||
      workspace.suspendedAt ||
      workspace.databaseSchema !== config.nativeSchema ||
      !workspace.databaseSchema ||
      !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(workspace.databaseSchema) ||
      !user ||
      user.disabled ||
      !user.isEmailVerified ||
      !userWorkspace ||
      !roleTarget ||
      roleTarget.role.workspaceId !== config.workspaceId
    ) {
      throw new UnauthorizedException('Company authorization denied');
    }
    // This fixed-schema query reads ONLY the already operator-bound identity.
    // Business records continue through native REST/TwentyORM user ACLs.
    const member = await this.dataSource
      .createQueryBuilder()
      .select('member.*')
      .from(workspace.databaseSchema + '.workspaceMember', 'member')
      .where(
        'member.id = :id AND member."userId" = :userId AND member."deletedAt" IS NULL',
        {
          id: binding.workspace_member_id,
          userId: binding.user_id,
        },
      )
      .getRawOne<unknown>();

    if (!member)
      throw new UnauthorizedException('Company authorization denied');
    const flatMember = companyMemberToFlat(member, binding);
    const current = await this.workspaceCacheService.getOrRecompute(
      config.workspaceId,
      ['userWorkspaceRoleMap'],
    );

    if (
      current.userWorkspaceRoleMap[binding.user_workspace_id] !==
      roleTarget.roleId
    ) {
      throw new UnauthorizedException('Company authorization denied');
    }

    return {
      user: fromUserEntityToFlat(user),
      workspace: fromWorkspaceEntityToFlat(workspace),
      userWorkspace: fromUserWorkspaceEntityToFlat(userWorkspace),
      userWorkspaceId: userWorkspace.id,
      workspaceMemberId: flatMember.id,
      workspaceMember: flatMember,
    };
  }
}
