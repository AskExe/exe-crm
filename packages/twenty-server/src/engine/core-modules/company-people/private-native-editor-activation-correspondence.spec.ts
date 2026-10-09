import { createHash } from 'node:crypto';

import { v5 } from 'uuid';

import {
  OwnedCoreNativeEditorAccessTransaction,
  readPrivateNativeEditorActivationLedger,
  verifyPrivateNativeEditorCurrentRole,
  type PrivateNativeEditorAccessSnapshot,
} from './private-native-editor-activation-correspondence';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const setup = (write = false) => {
  const recordRoles = {
    actionId: id(20),
    readerRoleId: v5('private-native-stock-record-reader-role-v1', id(20)),
    writerRoleId: v5('private-native-stock-record-writer-role-v1', id(20)),
    personObjectMetadataId: id(21),
    companyObjectMetadataId: id(22),
  };
  const ack = {
    request_id: id(1),
    company_id: id(2),
    subject_id: id(3),
    workspace_id: id(4),
    identity_sha256: 'a'.repeat(64),
    parent_session_id: id(5),
    parent_exp: '1000',
    user_id: id(6),
    user_workspace_id: id(7),
    workspace_member_id: id(8),
    role_id: write ? recordRoles.writerRoleId : recordRoles.readerRoleId,
    commit: 'acknowledged',
  };
  const ackBytes = bytes(ack),
    receipt = bytes([id(1), 'b'.repeat(64), ack]);
  const source: PrivateNativeEditorAccessSnapshot = {
    version: 2,
    activationScopes: write ? ['crm:read', 'crm:write'] : ['crm:read'],
    latestRequestId: id(1),
    recordRoles,
    requestId: id(1),
    companyId: id(2),
    subjectId: id(3),
    workspaceId: id(4),
    clientId: id(10),
    bindingId: id(11),
    generationId: id(12),
    authzEpoch: '1',
    audience: 'crm',
    activationPolicyRevision: 'activation-1',
    currentAccessPolicyRevision: 'access-2',
    payloadSha256: 'b'.repeat(64),
    identitySha256: 'a'.repeat(64),
    verifiedEmail: 'verified@example.test',
    activationParentSessionId: id(5),
    activationParentExp: '1000',
    currentParentSessionId: id(13),
    currentParentExp: '2000',
    attempt: 1,
    coordinatorId: id(14),
    receiptSha256: sha(receipt),
    profileSha256: 'c'.repeat(64),
    databaseAssociationSha256: 'd'.repeat(64),
  };
  let current = source,
    held = true;
  class Authority extends OwnedCoreNativeEditorAccessTransaction {
    assertHeld() {
      if (!held) throw new Error('not-held');
    }
    async assertCurrent() {
      return current;
    }
  }
  const row: Record<string, unknown> = {
    requestId: source.requestId,
    companyId: source.companyId,
    subjectId: source.subjectId,
    workspaceId: source.workspaceId,
    clientId: source.clientId,
    bindingId: source.bindingId,
    generationId: source.generationId,
    authzEpoch: source.authzEpoch,
    audience: source.audience,
    policyRevision: source.activationPolicyRevision,
    payloadSha256: source.payloadSha256,
    identitySha256: source.identitySha256,
    parentSessionId: source.activationParentSessionId,
    parentExp: source.activationParentExp,
    attempt: 1,
    coordinatorId: source.coordinatorId,
    profileSha256: source.profileSha256,
    databaseAssociationSha256: source.databaseAssociationSha256,
    userId: ack.user_id,
    userWorkspaceId: ack.user_workspace_id,
    workspaceMemberId: ack.workspace_member_id,
    roleId: ack.role_id,
    ackUtf8: ackBytes,
    ackSha256: sha(ackBytes),
    receiptInputUtf8: receipt,
    receiptSha256: source.receiptSha256,
    activationVersion: 2,
    activationScopes: source.activationScopes,
  };
  const nativeRow = {
    workspaceId: id(4),
    userId: id(6),
    userWorkspaceId: id(7),
    workspaceMemberId: id(8),
    roleId: ack.role_id,
  };
  const query = jest.fn(
    async (sql: string, _parameters?: unknown[]): Promise<unknown> =>
      sql.includes('privateNativeIdentityActivation') ? [row] : [nativeRow],
  );
  const runner = { isTransactionActive: true, isReleased: false, query };
  const end = { signal: new AbortController().signal, remaining: () => 50 };
  return {
    source,
    row,
    nativeRow,
    query,
    runner,
    end,
    authority: new Authority(),
    change: (next: PrivateNativeEditorAccessSnapshot) => {
      current = next;
    },
    release: () => {
      held = false;
    },
  };
};

describe('V2 current native scoped correspondence', () => {
  it.each([false, true])(
    'selects only the frozen role for current write=%s',
    async (write) => {
      const f = setup(write);
      const result = await verifyPrivateNativeEditorCurrentRole(
        f.runner,
        f.authority,
        f.end,
      );
      expect(result.roleId).toBe(
        write
          ? f.source.recordRoles.writerRoleId
          : f.source.recordRoles.readerRoleId,
      );
      expect(result.scopes).toEqual(f.source.activationScopes);
      expect(f.query.mock.calls[1][1]?.[7]).toBe(write);
      expect(f.query.mock.calls[1][1]?.slice(9)).toEqual([
        f.source.recordRoles.actionId,
        f.source.subjectId,
        id(21),
        id(22),
      ]);
    },
  );
  it('refuses an historical writer receipt after current scopes downgrade', async () => {
    const f = setup(true);
    f.change({ ...f.source, activationScopes: ['crm:read'] });
    await expect(
      readPrivateNativeEditorActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('refuses a newer pending request rather than fall back to completed history', async () => {
    const f = setup();
    f.change({ ...f.source, latestRequestId: id(99) });
    await expect(
      readPrivateNativeEditorActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('refuses a caller substituted role even with a valid UUID', async () => {
    const f = setup();
    f.change({
      ...f.source,
      recordRoles: { ...f.source.recordRoles, readerRoleId: id(99) },
    });
    await expect(
      readPrivateNativeEditorActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('refuses authority change during the native read', async () => {
    const f = setup();
    f.query.mockImplementation(async (sql) => {
      if (sql.includes('privateNativeIdentityActivation')) return [f.row];
      f.change({ ...f.source, authzEpoch: '2' });
      return [f.nativeRow];
    });
    await expect(
      verifyPrivateNativeEditorCurrentRole(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('refuses missing native correspondence instead of treating receipt as current access', async () => {
    const f = setup();
    f.query.mockImplementation(async (sql) =>
      sql.includes('privateNativeIdentityActivation') ? [f.row] : [],
    );
    await expect(
      verifyPrivateNativeEditorCurrentRole(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('refuses released Core locks before querying', async () => {
    const f = setup();
    f.release();
    await expect(
      readPrivateNativeEditorActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow('not-held');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('refuses accessor-backed ledger rows without executing the getter', async () => {
    const f = setup();
    const getter = jest.fn(() => f.source.activationScopes);
    Object.defineProperty(f.row, 'activationScopes', {
      get: getter,
      enumerable: true,
    });
    await expect(
      readPrivateNativeEditorActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
