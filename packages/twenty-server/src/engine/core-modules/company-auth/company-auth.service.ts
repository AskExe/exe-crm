import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

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

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

import { type RawAuthContext } from 'src/engine/core-modules/auth/types/auth-context.type';
import {
  OnboardingStepKeys,
  type OnboardingKeyValueTypeMap,
} from 'src/engine/core-modules/onboarding/onboarding.service';
import { UserVarsService } from 'src/engine/core-modules/user/user-vars/services/user-vars.service';
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
import {
  companyEditorAccess,
  type CompanyEditorAccess,
} from './company-editor-access.contract';
import { companyEditorEnabled } from './company-editor.config';
import { readCompanyBrowserConfiguration } from './company-browser.config';
import {
  companyEditorContextDigest,
  issueCompanyEditorCsrf,
  verifyCompanyEditorCsrf,
} from './company-editor.csrf';

@Injectable()
export class CompanyAuthService {
  readonly configuration = readCompanyAuthConfiguration();
  readonly editorEnabled = companyEditorEnabled();
  private readonly editorBrowser = this.editorEnabled
    ? readCompanyBrowserConfiguration(this.configuration)
    : null;
  private readonly editorContexts = new WeakMap<
    RawAuthContext,
    CompanyEditorAccess
  >();
  private readonly editorRequests = new WeakMap<Request, CompanyEditorAccess>();
  private readonly editorRequestScope = new AsyncLocalStorage<{
    request: Request;
    contextDigest: string;
    fingerprint: string;
    context: RawAuthContext;
    csrf: string | undefined;
    signal: AbortSignal;
  }>();

  editorAuthority(request: Request): CompanyEditorAccess | undefined {
    return this.editorRequests.get(request);
  }

  async withEditorRequest(request: Request, next: () => void): Promise<void> {
    if (!this.editorEnabled) {
      next();
      return;
    }
    const signal = AbortSignal.timeout(10_000);
    const current = await this.currentRead(request, signal);
    const authority = this.editorRequests.get(request);
    const csrf = request.headers['x-exe-company-csrf'];
    if (
      !authority ||
      (csrf !== undefined && typeof csrf !== 'string') ||
      request.headers['x-exe-company-context'] !==
        companyEditorContextDigest(authority)
    )
      throw new UnauthorizedException('Company authorization denied');
    this.editorRequestScope.run(
      Object.freeze({
        request,
        contextDigest: companyEditorContextDigest(authority),
        fingerprint: current.fingerprint,
        context: current.context,
        csrf,
        signal,
      }),
      next,
    );
  }

  async assertEditorRecord(readOnly: boolean, system: boolean): Promise<void> {
    if (!this.editorEnabled) return;
    const captured = this.editorRequestScope.getStore();
    // The unchanged v1 REST/key reader cannot enter an editor mutation.
    if (!captured && readOnly) return;
    if (!captured || system)
      throw new UnauthorizedException('Company authorization denied');
    captured.signal.throwIfAborted();
    if (readOnly) return;
    await this.assertEditorWrite(
      captured.request,
      captured.contextDigest,
      captured.csrf,
      captured.signal,
    );
    const current = await this.currentRead(captured.request, captured.signal);
    const authority = this.editorRequests.get(captured.request);
    if (
      current.fingerprint !== captured.fingerprint ||
      !authority ||
      companyEditorContextDigest(authority) !== captured.contextDigest ||
      !authority.scopes.includes('crm:write')
    )
      throw new UnauthorizedException('Company authorization denied');
    captured.signal.throwIfAborted();
  }

  async assertEditorActor(authContext: WorkspaceAuthContext): Promise<void> {
    await this.assertEditorRecord(false, false);
    const bound = this.editorRequestScope.getStore()?.context;
    if (
      !bound ||
      authContext.type !== 'user' ||
      authContext.workspace.id !== bound.workspace?.id ||
      authContext.user.id !== bound.user?.id ||
      authContext.userWorkspaceId !== bound.userWorkspaceId ||
      authContext.workspaceMemberId !== bound.workspaceMemberId ||
      authContext.workspaceMember.id !== bound.workspaceMember?.id ||
      JSON.stringify(authContext.workspaceMember) !==
        JSON.stringify(bound.workspaceMember)
    )
      throw new UnauthorizedException('Company authorization denied');
  }

  async currentEditor(request: Request, signal?: AbortSignal) {
    if (!this.editorEnabled || companyCredential(request).kind !== 'session')
      throw new UnauthorizedException('Company authorization denied');
    const context = await this.authenticate(request, signal);
    const authority = this.editorRequests.get(request);
    if (!authority)
      throw new UnauthorizedException('Company authorization denied');
    return {
      context,
      authority,
      contextDigest: companyEditorContextDigest(authority),
    };
  }

  async editorBootstrap(request: Request, signal?: AbortSignal) {
    const current = await this.currentEditor(request, signal);
    if (!this.configuration || !this.editorBrowser)
      throw new UnauthorizedException('Company authorization denied');
    return {
      context: current.contextDigest,
      csrf: issueCompanyEditorCsrf(
        this.configuration,
        this.editorBrowser,
        companyCredential(request).value,
        current.contextDigest,
      ),
    };
  }

  async assertEditorWrite(
    request: Request,
    capturedContext: string,
    csrf: string | undefined,
    signal?: AbortSignal,
  ) {
    const current = await this.currentEditor(request, signal);
    if (
      !this.configuration ||
      !this.editorBrowser ||
      request.headers.origin !== this.configuration.origin ||
      capturedContext !== current.contextDigest ||
      !current.authority.scopes.includes('crm:write')
    )
      throw new UnauthorizedException('Company authorization denied');
    verifyCompanyEditorCsrf(
      csrf,
      this.configuration,
      this.editorBrowser,
      companyCredential(request).value,
      current.contextDigest,
    );
    return current;
  }

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly userVarsService: UserVarsService<OnboardingKeyValueTypeMap>,
  ) {}

  async authenticate(
    request: Request,
    signal?: AbortSignal,
  ): Promise<RawAuthContext> {
    this.editorRequests.delete(request);
    try {
      signal?.throwIfAborted();
      const context = await this.currentNativeContext(request, signal);
      signal?.throwIfAborted();
      const editor = this.editorContexts.get(context);
      if (editor) this.editorRequests.set(request, editor);
      else this.editorRequests.delete(request);
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

  async authenticateSessionToken(
    token: string,
    signal: AbortSignal,
  ): Promise<RawAuthContext> {
    if (!/^exs_[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Company authorization denied');
    try {
      signal.throwIfAborted();
      const context = await this.currentCredentialContext(
        { kind: 'session', value: token },
        signal,
      );
      signal.throwIfAborted();
      return context;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Company authorization unavailable',
      );
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
    if (!config)
      throw new UnauthorizedException('Company authorization denied');
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
    let editor: CompanyEditorAccess | null = null;
    const value: unknown = JSON.parse(body);
    try {
      if (this.editorEnabled && credential.kind === 'session') {
        editor = companyEditorAccess(value, {
          company_id: config.companyId,
          product: 'crm',
          binding_id: config.bindingId,
          native_id: config.workspaceId,
          generation_id: config.generationId,
          audience: config.audience,
        });
        if (!editor) throw new Error('Company authorization denied');
        subject = editor.subject_id;
      } else {
        subject = companySubject(value, config);
      }
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
    if (editor) {
      signal?.throwIfAborted();
      const onboarding = await this.userVarsService.getAll({
        userId: user.id,
        workspaceId: workspace.id,
      });
      signal?.throwIfAborted();
      // Hosted editors cannot complete native account/team management flows.
      // Read native pending flags; never invoke the status getter's cleanup writes.
      if (
        Object.values(OnboardingStepKeys).some(
          (key) => onboarding.get(key) === true,
        )
      )
        throw new UnauthorizedException('Company authorization denied');
    }
    // This fixed-schema query reads ONLY the already operator-bound identity.
    // Business records continue through native REST/ORM user ACLs.
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

    const context: RawAuthContext = {
      user: fromUserEntityToFlat(user),
      workspace: fromWorkspaceEntityToFlat(workspace),
      userWorkspace: fromUserWorkspaceEntityToFlat(userWorkspace),
      userWorkspaceId: userWorkspace.id,
      workspaceMemberId: flatMember.id,
      workspaceMember: flatMember,
    };
    if (editor) {
      this.editorContexts.set(
        context,
        Object.freeze({
          ...editor,
          scopes: Object.freeze([...editor.scopes]),
        }),
      );
    }
    return context;
  }
}
