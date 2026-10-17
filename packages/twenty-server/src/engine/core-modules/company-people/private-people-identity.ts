import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { type DataSource, type QueryRunner } from 'typeorm';

import { type UserWorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  COMPANY_UUID,
  type CompanyAuthConfiguration,
} from 'src/engine/core-modules/company-auth/company-auth.config';
import { companyMemberToFlat } from 'src/engine/core-modules/company-auth/company-member-to-flat';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { fromUserEntityToFlat } from 'src/engine/core-modules/user/utils/from-user-entity-to-flat.util';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { fromWorkspaceEntityToFlat } from 'src/engine/core-modules/workspace/utils/from-workspace-entity-to-flat.util';

import {
  type PrivatePeopleSource,
  type PrivatePeopleDeadline,
} from './private-people-contract';

// Called only after the fixed policy lock, on the SAME contact/ledger runner.
// Protected operator configuration maps the current Core subject; the request
// cannot select a native user, member, role or schema.
export const readPrivatePeopleIdentity = async (
  runner: QueryRunner,
  core: DataSource,
  configuration: CompanyAuthConfiguration,
  source: PrivatePeopleSource,
  end: PrivatePeopleDeadline,
) => {
  if (
    source.company_id !== configuration.companyId ||
    source.native_id !== configuration.workspaceId ||
    source.binding_id !== configuration.bindingId ||
    source.generation_id !== configuration.generationId ||
    source.client_id !== configuration.clientId ||
    source.audience !== configuration.audience
  )
    throw new Error('Private people binding unavailable');
  const binding = configuration.bindings.get(source.subject_id);
  if (!binding || !/^[a-z_][a-z0-9_]{0,62}$/.test(configuration.nativeSchema))
    throw new Error('Private people identity unavailable');
  const query = async (sql: string, parameters: unknown[]) => {
    end.remaining();
    const result = await runner.query(sql, parameters);
    end.remaining();
    return result;
  };
  const workspaces = await query(
    'SELECT * FROM core.workspace WHERE id=$1 AND "deletedAt" IS NULL',
    [source.native_id],
  );
  const users = await query(
    'SELECT * FROM core."user" WHERE id=$1 AND "deletedAt" IS NULL',
    [binding.user_id],
  );
  const memberships = await query(
    'SELECT * FROM core."userWorkspace" WHERE id=$1 AND "userId"=$2 AND "workspaceId"=$3 AND "deletedAt" IS NULL',
    [binding.user_workspace_id, binding.user_id, source.native_id],
  );
  const roles = await query(
    `SELECT r.* FROM core."roleTarget" t JOIN core.role r ON r.id=t."roleId"
    WHERE t."workspaceId"=$1 AND t."userWorkspaceId"=$2 AND r."workspaceId"=$1`,
    [source.native_id, binding.user_workspace_id],
  );
  if (
    workspaces.length !== 1 ||
    users.length !== 1 ||
    memberships.length !== 1 ||
    roles.length !== 1
  )
    throw new Error('Private people identity unavailable');
  const workspace = core
    .getRepository(WorkspaceEntity)
    .create(workspaces[0] as Partial<WorkspaceEntity>);
  const user = core
    .getRepository(UserEntity)
    .create(users[0] as Partial<UserEntity>);
  const membership = core
    .getRepository(UserWorkspaceEntity)
    .create(memberships[0] as Partial<UserWorkspaceEntity>);
  const role = roles[0];
  if (typeof role.id !== 'string' || !COMPANY_UUID.test(role.id))
    throw new Error('Private people role unavailable');
  if (
    workspace.activationStatus !== 'ACTIVE' ||
    workspace.suspendedAt !== null ||
    workspace.databaseSchema !== configuration.nativeSchema ||
    user.disabled !== false ||
    user.isEmailVerified !== true ||
    user.canImpersonate !== false ||
    user.canAccessFullAdminPanel !== false ||
    role.canUpdateAllSettings !== false ||
    role.canAccessAllTools !== false ||
    role.canReadAllObjectRecords !== false ||
    role.canUpdateAllObjectRecords !== false ||
    role.canDestroyAllObjectRecords !== false ||
    role.canSoftDeleteAllObjectRecords !== false
  )
    throw new Error('Private people identity unavailable');
  const permissions = await query(
    `SELECT p.id FROM core."objectPermission" p
    JOIN core."objectMetadata" o ON o.id=p."objectMetadataId"
    WHERE p."workspaceId"=$1 AND p."roleId"=$2 AND o."workspaceId"=$1
      AND o."nameSingular"='person' AND o."isCustom" IS FALSE AND o."isActive" IS TRUE
      AND o."universalIdentifier"=$3 AND p."canUpdateObjectRecords" IS TRUE AND p."canReadObjectRecords" IS TRUE`,
    [source.native_id, role.id, STANDARD_OBJECTS.person.universalIdentifier],
  );
  if (permissions.length !== 1)
    throw new Error('Private people insert permission unavailable');
  const members = await query(
    `SELECT * FROM "${configuration.nativeSchema}"."workspaceMember"
    WHERE id=$1 AND "userId"=$2 AND "deletedAt" IS NULL`,
    [binding.workspace_member_id, binding.user_id],
  );
  if (members.length !== 1)
    throw new Error('Private people member unavailable');
  const member = companyMemberToFlat(members[0], binding);
  const authContext: UserWorkspaceAuthContext = {
    type: 'user',
    workspace: fromWorkspaceEntityToFlat(workspace),
    user: fromUserEntityToFlat(user),
    userWorkspaceId: membership.id,
    workspaceMemberId: member.id,
    workspaceMember: member,
  };
  return { authContext, roleId: String(role.id) };
};
