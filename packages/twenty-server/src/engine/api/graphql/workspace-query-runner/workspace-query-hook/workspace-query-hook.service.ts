import { Injectable } from '@nestjs/common';

import { CompanyAuthService } from 'src/engine/core-modules/company-auth/company-auth.service';
import { companyEditorEnabled } from 'src/engine/core-modules/company-auth/company-editor.config';
import { CreatedByCreateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-one.pre-query-hook';
import { CreatedByCreateManyPreQueryHook } from 'src/engine/core-modules/actor/query-hooks/created-by.create-many.pre-query-hook';
import { UpdatedByUpdateOnePreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-one.pre-query-hook';
import { UpdatedByUpdateManyPreQueryHook } from 'src/engine/core-modules/actor/query-hooks/updated-by.update-many.pre-query-hook';

import { companyAuthEnabled } from 'src/engine/core-modules/company-auth/company-auth.config';

import merge from 'lodash.merge';

import { type QueryResultFieldValue } from 'src/engine/api/graphql/workspace-query-runner/factories/query-result-getters/interfaces/query-result-field-value';
import { type WorkspaceResolverBuilderMethodNames } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { CommonQueryNames } from 'src/engine/api/common/types/common-query-args.type';
import { type WorkspaceQueryHookKey } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { WorkspaceQueryHookStorage } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/storage/workspace-query-hook.storage';
import { type WorkspacePreQueryHookPayload } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
import { WorkspaceQueryHookExplorer } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.explorer';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

// Capture source implementations before any per-instance method changes.
const editorActorHooks = {
  createOne: {
    prototype: CreatedByCreateOnePreQueryHook.prototype,
    execute: CreatedByCreateOnePreQueryHook.prototype.execute,
  },
  createMany: {
    prototype: CreatedByCreateManyPreQueryHook.prototype,
    execute: CreatedByCreateManyPreQueryHook.prototype.execute,
  },
  updateOne: {
    prototype: UpdatedByUpdateOnePreQueryHook.prototype,
    execute: UpdatedByUpdateOnePreQueryHook.prototype.execute,
  },
  updateMany: {
    prototype: UpdatedByUpdateManyPreQueryHook.prototype,
    execute: UpdatedByUpdateManyPreQueryHook.prototype.execute,
  },
} as const;

@Injectable()
export class WorkspaceQueryHookService {
  constructor(
    private readonly workspaceQueryHookStorage: WorkspaceQueryHookStorage,
    private readonly workspaceQueryHookExplorer: WorkspaceQueryHookExplorer,
    private readonly companyAuthService: CompanyAuthService,
  ) {}

  //TODO : Refacto-common - Should be Common
  public async executePreQueryHooks<
    T extends WorkspaceResolverBuilderMethodNames | CommonQueryNames,
  >(
    authContext: WorkspaceAuthContext,
    // TODO: We should allow wildcard for object name
    objectName: string,
    methodName: T,
    payload: WorkspacePreQueryHookPayload<T>,
  ): Promise<WorkspacePreQueryHookPayload<T>> {
    const key: WorkspaceQueryHookKey = `${objectName}.${methodName}`;
    const preHookInstances =
      this.workspaceQueryHookStorage.getWorkspaceQueryPreHookInstances(key);

    if (
      companyEditorEnabled() &&
      this.workspaceQueryHookStorage.getWorkspacePostQueryHookInstances(key)
        .length !== 0
    ) {
      throw new Error('Company editor hook denied');
    }
    if (
      companyEditorEnabled() &&
      (preHookInstances.length ||
        Object.prototype.hasOwnProperty.call(editorActorHooks, methodName))
    ) {
      const expected = Object.prototype.hasOwnProperty.call(
        editorActorHooks,
        methodName,
      )
        ? editorActorHooks[methodName as keyof typeof editorActorHooks]
        : undefined;
      const hook = preHookInstances[0];
      if (
        !['person', 'company', 'opportunity'].includes(objectName) ||
        !expected ||
        preHookInstances.length !== 1 ||
        !hook ||
        hook.registrationKey !== `*.${methodName}` ||
        hook.isRequestScoped ||
        Object.getPrototypeOf(hook.instance) !== expected.prototype ||
        hook.instance.execute !== expected.execute ||
        this.workspaceQueryHookStorage.getWorkspacePostQueryHookInstances(key)
          .length !== 0
      )
        throw new Error('Company editor hook denied');
      await this.companyAuthService.assertEditorActor(authContext);
      // Sanitize the merge destination too: caller actor fields must not return.
      const sanitized = structuredClone(payload);
      const data = (
        sanitized as unknown as {
          data: Record<string, unknown> | Record<string, unknown>[];
        }
      ).data;
      const records = Array.isArray(data) ? data : [data];
      for (const record of records) {
        if (!record || typeof record !== 'object')
          throw new Error('Company editor hook denied');
        delete record.createdBy;
        delete record.updatedBy;
      }
      const hookPayload = await this.workspaceQueryHookExplorer.handlePreHook(
        [authContext, objectName, sanitized],
        hook.instance,
        hook.host,
        false,
      );
      await this.companyAuthService.assertEditorActor(authContext);
      return merge(sanitized, hookPayload);
    }

    if (companyAuthEnabled() && preHookInstances?.length) {
      throw new Error('Company read hooks require separate review');
    }

    if (!preHookInstances) {
      return payload;
    }

    for (const preHookInstance of preHookInstances) {
      // Deep merge all return of handleHook into payload before returning it
      const hookPayload = await this.workspaceQueryHookExplorer.handlePreHook(
        [authContext, objectName, payload],
        preHookInstance.instance,
        preHookInstance.host,
        preHookInstance.isRequestScoped,
      );

      // TODO: Is it really a good idea ?
      payload = merge(payload, hookPayload);
    }

    return payload;
  }

  public async executePostQueryHooks<
    T extends WorkspaceResolverBuilderMethodNames,
  >(
    authContext: WorkspaceAuthContext,
    // TODO: We should allow wildcard for object name
    objectName: string,
    methodName: T,
    payload: QueryResultFieldValue,
  ): Promise<void> {
    const key: WorkspaceQueryHookKey = `${objectName}.${methodName}`;
    const postHookInstances =
      this.workspaceQueryHookStorage.getWorkspacePostQueryHookInstances(key);

    if (companyAuthEnabled() && postHookInstances?.length) {
      throw new Error('Company read hooks require separate review');
    }

    if (!postHookInstances) {
      return;
    }

    for (const postHookInstance of postHookInstances) {
      await this.workspaceQueryHookExplorer.handlePostHook(
        [authContext, objectName, payload],
        postHookInstance.instance,
        postHookInstance.host,
        postHookInstance.isRequestScoped,
      );
    }
  }
}
