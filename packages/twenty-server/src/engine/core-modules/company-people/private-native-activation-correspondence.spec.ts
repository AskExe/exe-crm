import { createHash } from 'node:crypto';

import {
  readPrivateNativeActivationAck,
  readPrivateNativeActivationLedger,
  verifyPrivateNativeActivationIdentity,
  OwnedCoreNativeAccessTransaction,
  type PrivateNativeCorrespondenceRunner,
  verifyPrivateNativeActivationReceipt,
  type PrivateNativeAccessSnapshot,
} from './private-native-activation-correspondence';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
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
  role_id: id(9),
  commit: 'acknowledged',
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');
const fixture = () => {
  const original = bytes(ack);
  const receipt = bytes([ack.request_id, 'b'.repeat(64), ack]);
  const source: PrivateNativeAccessSnapshot = {
    requestId: ack.request_id,
    companyId: ack.company_id,
    subjectId: ack.subject_id,
    workspaceId: ack.workspace_id,
    clientId: id(10),
    bindingId: id(11),
    generationId: id(12),
    authzEpoch: '1',
    audience: 'crm',
    activationPolicyRevision: 'activation-1',
    currentAccessPolicyRevision: 'access-9',
    payloadSha256: 'b'.repeat(64),
    identitySha256: ack.identity_sha256,
    verifiedEmail: 'verified@example.test',
    activationParentSessionId: ack.parent_session_id,
    activationParentExp: ack.parent_exp,
    currentParentSessionId: id(13),
    currentParentExp: '2000',
    attempt: 1,
    coordinatorId: id(14),
    receiptSha256: createHash('sha256').update(receipt).digest('hex'),
    profileSha256: 'c'.repeat(64),
    databaseAssociationSha256: 'd'.repeat(64),
  };
  return { original, receipt, source };
};

describe('private native activation byte correspondence', () => {
  it('accepts exact original ACK and receipt bytes without granting access', () => {
    const f = fixture();
    const result = verifyPrivateNativeActivationReceipt(
      f.original,
      f.receipt,
      f.source,
    );
    expect(result.ack).toEqual(ack);
    expect(Object.isFrozen(result.ack)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['ack', 'ackSha256']);
  });
  it('preserves original ACK property ordering in the receipt', () => {
    const f = fixture();
    const reversed = Object.fromEntries(Object.entries(ack).reverse());
    const original = bytes(reversed);
    const receipt = bytes([ack.request_id, f.source.payloadSha256, reversed]);
    const source = {
      ...f.source,
      receiptSha256: createHash('sha256').update(receipt).digest('hex'),
    };
    expect(
      verifyPrivateNativeActivationReceipt(original, receipt, source).ack,
    ).toEqual(ack);
    expect(() =>
      verifyPrivateNativeActivationReceipt(original, f.receipt, f.source),
    ).toThrow();
  });
  it('refuses duplicate keys rather than normalize them', () => {
    const duplicate = Buffer.from(
      JSON.stringify(ack).replace('{', '{"request_id":"' + id(1) + '",'),
    );
    expect(() => readPrivateNativeActivationAck(duplicate)).toThrow();
  });
  it('refuses trailing whitespace rather than rewrite original bytes', () => {
    expect(() =>
      readPrivateNativeActivationAck(
        Buffer.concat([bytes(ack), Buffer.from(' ')]),
      ),
    ).toThrow();
  });
  it('refuses extra ACK authority fields', () => {
    expect(() =>
      readPrivateNativeActivationAck(bytes({ ...ack, access: true })),
    ).toThrow();
  });
  it('refuses missing ACK identity fields', () => {
    const { role_id: _role, ...missing } = ack;
    expect(() => readPrivateNativeActivationAck(bytes(missing))).toThrow();
  });
  it('refuses nonacknowledged or malformed canonical identifiers', () => {
    for (const invalid of [
      { ...ack, commit: 'uncertain' },
      { ...ack, user_id: id(6).toUpperCase().replace('4000', '0000') },
    ])
      expect(() => readPrivateNativeActivationAck(bytes(invalid))).toThrow();
  });
  it('refuses malformed UTF8 and oversized ACK bytes', () => {
    expect(() =>
      readPrivateNativeActivationAck(Uint8Array.from([0xff])),
    ).toThrow();
    expect(() =>
      readPrivateNativeActivationAck(new Uint8Array(4097)),
    ).toThrow();
  });
  it('refuses foreign company subject workspace and historical parent', () => {
    const f = fixture();
    for (const source of [
      { ...f.source, companyId: id(99) },
      { ...f.source, subjectId: id(99) },
      { ...f.source, workspaceId: id(99) },
      { ...f.source, activationParentSessionId: id(99) },
      { ...f.source, activationParentExp: '999' },
    ])
      expect(() =>
        verifyPrivateNativeActivationReceipt(f.original, f.receipt, source),
      ).toThrow();
  });
  it('refuses altered payload receipt bytes and receipt digest', () => {
    const f = fixture();
    expect(() =>
      verifyPrivateNativeActivationReceipt(f.original, f.receipt, {
        ...f.source,
        payloadSha256: 'e'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      verifyPrivateNativeActivationReceipt(
        f.original,
        Buffer.concat([f.receipt, Buffer.from(' ')]),
        f.source,
      ),
    ).toThrow();
    expect(() =>
      verifyPrivateNativeActivationReceipt(f.original, f.receipt, {
        ...f.source,
        receiptSha256: 'e'.repeat(64),
      }),
    ).toThrow();
  });
  it('does not substitute the current session for historical activation correspondence', () => {
    const f = fixture();
    expect(f.source.currentParentSessionId).not.toBe(
      f.source.activationParentSessionId,
    );
    expect(
      verifyPrivateNativeActivationReceipt(f.original, f.receipt, f.source).ack
        .parent_session_id,
    ).toBe(f.source.activationParentSessionId);
  });
  it('keeps independent access and historical activation policy revisions', () => {
    const f = fixture();
    expect(f.source.currentAccessPolicyRevision).not.toBe(
      f.source.activationPolicyRevision,
    );
    expect(
      verifyPrivateNativeActivationReceipt(f.original, f.receipt, f.source).ack,
    ).toEqual(ack);
  });
});

describe('private native owned correspondence sequencing', () => {
  const setup = () => {
    const f = fixture();
    const calls: string[] = [];
    let held = true;
    let after: PrivateNativeAccessSnapshot = f.source;
    let currentCalls = 0;
    class Authority extends OwnedCoreNativeAccessTransaction {
      assertHeld() {
        calls.push('held');
        if (!held) throw new Error('not-held');
      }
      async assertCurrent() {
        calls.push('current');
        return ++currentCalls === 1 ? f.source : after;
      }
    }
    const row = {
      requestId: f.source.requestId,
      companyId: f.source.companyId,
      subjectId: f.source.subjectId,
      workspaceId: f.source.workspaceId,
      clientId: f.source.clientId,
      bindingId: f.source.bindingId,
      generationId: f.source.generationId,
      authzEpoch: f.source.authzEpoch,
      audience: f.source.audience,
      policyRevision: f.source.activationPolicyRevision,
      payloadSha256: f.source.payloadSha256,
      identitySha256: f.source.identitySha256,
      parentSessionId: f.source.activationParentSessionId,
      parentExp: f.source.activationParentExp,
      attempt: 1,
      coordinatorId: f.source.coordinatorId,
      profileSha256: f.source.profileSha256,
      databaseAssociationSha256: f.source.databaseAssociationSha256,
      userId: ack.user_id,
      userWorkspaceId: ack.user_workspace_id,
      workspaceMemberId: ack.workspace_member_id,
      roleId: ack.role_id,
      ackUtf8: f.original,
      ackSha256: createHash('sha256').update(f.original).digest('hex'),
      receiptInputUtf8: f.receipt,
      receiptSha256: f.source.receiptSha256,
    };
    const query = jest.fn(async (_sql: string, _parameters?: unknown[]) => {
      calls.push('query');
      return [row];
    });
    const runner: PrivateNativeCorrespondenceRunner = {
      isTransactionActive: true,
      isReleased: false,
      query,
    };
    const end = {
      signal: new AbortController().signal,
      remaining: () => {
        calls.push('end');
        return 50;
      },
    };
    return {
      ...f,
      row,
      runner,
      query,
      calls,
      end,
      authority: new Authority(),
      releaseLocks: () => {
        held = false;
      },
      changeCurrent: (value: PrivateNativeAccessSnapshot) => {
        after = value;
      },
    };
  };
  it('retains Core ownership before query and rechecks current authority after settlement', async () => {
    const f = setup();
    const result = await readPrivateNativeActivationLedger(
      f.runner,
      f.authority,
      f.end,
    );
    expect(f.calls).toEqual([
      'held',
      'current',
      'held',
      'end',
      'query',
      'held',
      'end',
      'current',
      'held',
      'end',
    ]);
    expect(f.query.mock.calls[0][1]).toEqual([f.source.requestId]);
    expect(Object.keys(result).sort()).toEqual(['ack', 'ackSha256']);
  });
  it('does not query after ownership has already been lost', async () => {
    const f = setup();
    f.releaseLocks();
    await expect(
      readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow('not-held');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('refuses ownership loss while the native ledger query is pending', async () => {
    const f = setup();
    f.query.mockImplementation(async () => {
      f.releaseLocks();
      return [f.row];
    });
    await expect(
      readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow('not-held');
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('refuses zero or duplicate rows instead of choosing one', async () => {
    for (const count of [0, 2]) {
      const f = setup();
      f.query.mockImplementation(async () =>
        Array.from({ length: count }, () => f.row),
      );
      await expect(
        readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
      ).rejects.toThrow();
    }
  });
  it('compares the stored policy only to historical activation policy', async () => {
    const f = setup();
    f.row.policyRevision = f.source.currentAccessPolicyRevision;
    await expect(
      readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('refuses current access policy change across the native query', async () => {
    const f = setup();
    f.changeCurrent({ ...f.source, currentAccessPolicyRevision: 'access-10' });
    await expect(
      readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('refuses changed generation rather than rotating a historical ledger', async () => {
    const f = setup();
    f.row.generationId = id(99);
    await expect(
      readPrivateNativeActivationLedger(f.runner, f.authority, f.end),
    ).rejects.toThrow();
  });
  it('hard-refuses initial identity IO while real native isolation is unavailable', async () => {
    const f = setup();
    const config = {
      companyId: id(2),
      workspaceId: id(4),
      nativeSchema: 'workspace_test',
      bindingId: id(11),
      generationId: id(12),
      audience: 'crm',
      clientId: id(10),
      origin: 'http://private-crm:3000',
      brokerUrl: 'http://private-core:3000',
      authorityUrl: 'http://private-core:3000',
      clientSecret: 'controlled-unused',
      bindings: new Map(),
    };
    await expect(
      verifyPrivateNativeActivationIdentity(
        f.runner,
        f.authority,
        config,
        readPrivateNativeActivationAck(f.original),
        f.end,
      ),
    ).rejects.toThrow('Private native identity isolation unavailable');
    expect(f.query).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });
});
