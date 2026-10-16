// Run only against a disposable, stock-migrated and stock-seeded database.
// The fixture is test data; it is never a Core receipt or onboarding admission.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { v5 } = require('uuid');
const source = process.env.PRIVATE_NATIVE_CURRENT_COMPILED_ROOT;
assert(source && process.env.PRIVATE_NATIVE_CURRENT_TEST_DSN);
const { PRIVATE_NATIVE_CURRENT_BODY, PRIVATE_NATIVE_CURRENT_TABLES } = require(
  `${source}/private-native-current-policy.js`,
);
const { PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY } = require(
  `${source}/private-native-editor-activation-policy.js`,
);
const { PrivateNativeCurrentIsolation } = require(
  `${source}/private-native-current-isolation.js`,
);
const { bindPrivateNativeEditorActivationAdapter } = require(
  `${source}/private-native-editor-activation-credential.js`,
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const admin = new DataSource({
  type: 'postgres',
  url: process.env.PRIVATE_NATIVE_CURRENT_TEST_DSN,
});
await admin.initialize();
const connect = async (role) => {
  const url = new URL(process.env.PRIVATE_NATIVE_CURRENT_TEST_DSN);
  url.username = role;
  const db = new DataSource({
    type: 'postgres',
    url: url.href,
    connectTimeoutMS: 500,
  });
  await db.initialize();
  return db;
};
let reader, activator;
const passed = [];
const handles = [],
  currentLocks = [],
  runners = [];
const end = (signal = new AbortController().signal) => {
  const until = performance.now() + 4900;
  return {
    signal,
    remaining() {
      const value = until - performance.now();
      if (value <= 0) throw Error('deadline');
      return value;
    },
  };
};
try {
  assert.deepEqual(
    await admin.query(
      'SELECT current_user,oid FROM pg_roles WHERE rolname=current_user',
    ),
    [{ current_user: 'crm_setup_operator', oid: 10 }],
  );
  const workspaces = await admin.query(
    'SELECT id,"databaseSchema","workspaceCustomApplicationId" FROM core.workspace',
  );
  assert.equal(workspaces.length, 1);
  const {
    id: workspaceId,
    databaseSchema: schema,
    workspaceCustomApplicationId: applicationId,
  } = workspaces[0];
  assert.equal(workspaceId, '20202020-1c25-4d02-bf25-6aeccf7ea419');
  assert.equal(schema, 'workspace_1wgvd1injqtife6y4rvfbu3h5');
  assert.match(applicationId, /^[0-9a-f-]{36}$/);
  const memberships = await admin.query(
    'SELECT id,"userId" FROM core."userWorkspace" WHERE "workspaceId"=$1 AND id=$2',
    [workspaceId, '20202020-9e3b-46d4-a556-88b9ddc2b035'],
  );
  assert.equal(memberships.length, 1);
  const [{ id: userWorkspaceId, userId }] = memberships;
  assert.equal(userId, '20202020-9e3b-46d4-a556-88b9ddc2b034');
  assert.equal(userWorkspaceId, '20202020-9e3b-46d4-a556-88b9ddc2b035');
  const members = await admin.query(
    `SELECT id FROM "${schema}"."workspaceMember" WHERE "userId"=$1`,
    [userId],
  );
  assert.equal(members.length, 1);
  const [{ id: memberId }] = members;
  assert.equal(memberId, '20202020-0687-4c41-b707-ed1bfca972a7');
  assert.deepEqual(
    (await admin.query('SELECT datname FROM pg_database ORDER BY datname')).map(
      (row) => row.datname,
    ),
    ['crm_training', 'postgres', 'template0', 'template1'],
  );
  const actionId = randomUUID(),
    companyId = randomUUID(),
    subjectId = randomUUID();
  const association = {
    actionId,
    companyId,
    subjectId,
    workspaceId,
    profileSha256: 'c'.repeat(64),
    databaseAssociationSha256: 'd'.repeat(64),
  };
  // Test-only stock-row copies preserve the actual entity columns and defaults.
  const roleRows = await admin.query(
    'SELECT * FROM core.role WHERE "workspaceId"=$1 LIMIT 1',
    [workspaceId],
  );
  const templateRole = roleRows[0];
  assert(templateRole);
  const roles = {};
  for (const kind of ['reader', 'writer', 'guest']) {
    const id =
      kind === 'guest'
        ? randomUUID()
        : v5(`private-native-stock-record-${kind}-role-v1`, actionId);
    roles[kind] = id;
    const row = {
      ...templateRole,
      id,
      label: kind === 'guest' ? 'Guest' : `Company record ${kind}`,
      applicationId,
      universalIdentifier:
        kind === 'guest'
          ? randomUUID()
          : v5(
              `private-native-stock-record-${kind}-role-universal-v1`,
              actionId,
            ),
      isEditable: false,
      canBeAssignedToUsers: true,
      canBeAssignedToAgents: false,
      canBeAssignedToApiKeys: false,
      canReadAllObjectRecords: kind === 'guest',
      canUpdateAllObjectRecords: false,
      canSoftDeleteAllObjectRecords: false,
      canDestroyAllObjectRecords: false,
      canUpdateAllSettings: false,
      canAccessAllTools: false,
    };
    await admin.query(
      'INSERT INTO core.role SELECT (jsonb_populate_record(NULL::core.role,$1::jsonb)).*',
      [JSON.stringify(row)],
    );
  }
  const objects = await admin.query(
    'SELECT id,"nameSingular" FROM core."objectMetadata" WHERE "workspaceId"=$1 AND "nameSingular" IN(\'person\',\'company\')',
    [workspaceId],
  );
  assert.equal(objects.length, 2);
  for (const kind of ['reader', 'writer'])
    for (const object of objects)
      await admin.query(
        'INSERT INTO core."objectPermission"("roleId","workspaceId","applicationId","objectMetadataId","universalIdentifier","canReadObjectRecords","canUpdateObjectRecords","canSoftDeleteObjectRecords","canDestroyObjectRecords") VALUES($1,$2,$3,$4,$5,true,$6,false,false)',
        [
          roles[kind],
          workspaceId,
          applicationId,
          object.id,
          randomUUID(),
          kind === 'writer',
        ],
      );
  await admin.query(
    'UPDATE core."roleTarget" SET "roleId"=$1 WHERE "userWorkspaceId"=$2',
    [roles.guest, userWorkspaceId],
  );
  await admin.query(
    'UPDATE core."user" SET "passwordHash"=NULL,disabled=false,"canImpersonate"=false,"canAccessFullAdminPanel"=false,"isEmailVerified"=false WHERE id=$1',
    [userId],
  );
  const setupUser = v5('private-native-stock-setup-user-v1', actionId);
  const [userTemplate] = await admin.query(
    'SELECT * FROM core."user" WHERE id=$1',
    [userId],
  );
  await admin.query(
    'INSERT INTO core."user" SELECT (jsonb_populate_record(NULL::core."user",$1::jsonb)).*',
    [
      JSON.stringify({
        ...userTemplate,
        id: setupUser,
        email: `fixture-${setupUser}@example.test`,
        disabled: true,
        deletedAt: new Date().toISOString(),
        isEmailVerified: false,
      }),
    ],
  );
  await admin.query(
    'INSERT INTO core."privateNativeAction"("actionId","intentId","jobId","companyId","deploymentId","requestKey","ownerSubject",attempt,"workerId","profileSha256","configSha256","initializerSha256","packageSha256","plannedWorkspaceId","plannedUserId","plannedUserWorkspaceId","plannedApplicationId") VALUES($1,$2,$3,$4,$5,$6,$7,1,\'fixture\',$8,$8,$8,$8,$9,$10,$11,$12)',
    [
      actionId,
      randomUUID(),
      randomUUID(),
      companyId,
      randomUUID(),
      randomUUID(),
      subjectId,
      association.profileSha256,
      workspaceId,
      userId,
      userWorkspaceId,
      applicationId,
    ],
  );
  await admin.query(
    'INSERT INTO core."privateNativeWorkspaceBinding"("actionId","workspaceId","userId","userWorkspaceId") VALUES($1,$2,$3,$4)',
    [actionId, workspaceId, userId, userWorkspaceId],
  );
  await admin.query(
    'REVOKE ALL ON DATABASE crm_training FROM PUBLIC; REVOKE CONNECT ON DATABASE postgres,template0,template1 FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC',
  );
  // Password is held only in this process and inherited from the disposable DSN.
  const secret = decodeURIComponent(
    new URL(process.env.PRIVATE_NATIVE_CURRENT_TEST_DSN).password,
  );
  for (const role of [
    'exe_crm_native_current_reader',
    'exe_crm_native_identity_activator',
  ]) {
    await admin.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${secret.replaceAll("'", "''")}'`,
    );
    await admin.query(
      `GRANT CONNECT ON DATABASE crm_training TO ${role}; GRANT USAGE ON SCHEMA core TO ${role}`,
    );
  }
  // Existing migration helpers are not granted to these distinct test logins.
  const definers = await admin.query(
    "SELECT oid::regprocedure::text AS name FROM pg_proc WHERE prosecdef AND pronamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)",
  );
  for (const { name } of definers)
    await admin.query(`REVOKE ALL ON FUNCTION ${name} FROM PUBLIC`);
  await admin.query(
    `GRANT SELECT ON ${PRIVATE_NATIVE_CURRENT_TABLES.map((t) => `core."${t}"`).join(',')} TO exe_crm_native_current_reader`,
  );
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schema}" TO exe_crm_native_current_reader; GRANT SELECT ON "${schema}"."workspaceMember" TO exe_crm_native_current_reader`,
  );
  for (const [name, signature, returns, body, role] of [
    [
      'lock_original_crm_current_identity',
      'expected jsonb',
      'boolean',
      PRIVATE_NATIVE_CURRENT_BODY,
      'exe_crm_native_current_reader',
    ],
    [
      'activate_original_crm_editor_identity',
      'request jsonb, canonical_payload bytea',
      'jsonb',
      PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY,
      'exe_crm_native_identity_activator',
    ],
  ]) {
    await admin.query(
      `CREATE FUNCTION core.${name}(${signature}) RETURNS ${returns} LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,core,pg_temp AS $body$${body}$body$`,
    );
    const args = name.startsWith('lock') ? 'jsonb' : 'jsonb,bytea';
    await admin.query(
      `REVOKE ALL ON FUNCTION core.${name}(${args}) FROM PUBLIC; GRANT EXECUTE ON FUNCTION core.${name}(${args}) TO ${role}`,
    );
  }
  reader = await connect('exe_crm_native_current_reader');
  activator = await connect('exe_crm_native_identity_activator');
  const requestId = randomUUID(),
    parentId = randomUUID();
  const payload = Buffer.from(
    JSON.stringify({
      subject_id: subjectId,
      verified_email: 'fixture-current@example.test',
      email_confirmed_at: '2020-01-01T00:00:00.000Z',
      identity_sha256: 'a'.repeat(64),
      activation_scopes: ['crm:read', 'crm:write'],
    }),
  );
  const projection = {
    version: 2,
    entitlement_kind: 'beta',
    commerce: null,
    purpose: 'native-identity-activation',
    action: 'crm:native-identity:activate',
    product: 'crm',
    resource_kind: 'crm-workspace',
    current_role: 'owner',
    verified_email: 'fixture-current@example.test',
    email_confirmed_at: '2020-01-01T00:00:00.000Z',
    identity_sha256: 'a'.repeat(64),
    subject_id: subjectId,
    company_id: companyId,
    client_id: 'crm_training',
    binding_id: randomUUID(),
    native_id: workspaceId,
    generation_id: randomUUID(),
    authz_epoch: '1',
    audience: 'crm_training',
    policy_revision: '1',
    activation_scopes: ['crm:read', 'crm:write'],
    request_id: requestId,
    payload_sha256: digest(payload),
    expires_at: new Date(Date.now() + 4500).toISOString(),
    parent_session_id: parentId,
    parent_exp: '2000000000',
    attempt: 1,
    coordinator_id: 'fixture_coordinator',
  };
  const catalogQuery = activator.query.bind(activator);
  activator.query = async (...parameters) => {
    const rows = await catalogQuery(...parameters);
    if (
      String(parameters[0]).includes('FROM pg_proc p') &&
      rows[0] &&
      (!rows[0].identity || !rows[0].ceiling || !rows[0].helper)
    ) {
      console.error(
        JSON.stringify({
          activationCatalog: {
            identity: rows[0].identity,
            ceiling: rows[0].ceiling,
            helper: rows[0].helper,
            bodyMatches: rows[0].body === PRIVATE_NATIVE_EDITOR_ACTIVATION_BODY,
          },
        }),
      );
    }
    return rows;
  };
  const deadline = end();
  const adapter = await bindPrivateNativeEditorActivationAdapter(
    true,
    activator,
    association,
    { invalidateAndRecompute: async () => {} },
    { invalidate: async () => {} },
    deadline,
    reader,
  );
  const transaction = adapter.createHandle(projection, payload, deadline);
  handles.push(transaction);
  let ack;
  try {
    await transaction.prepare();
    ack = await transaction.commit();
  } catch (error) {
    console.error('initial-activation-failed', error);
    await transaction.rollback(end()).catch(() => {});
    throw error;
  } finally {
    await transaction.dispose(end());
  }
  assert.equal(ack.role_id, roles.writer);
  passed.push('actual-native-activation-commit');
  const [ledger] = await admin.query(
    'SELECT "receiptSha256" FROM core."privateNativeIdentityActivation" WHERE "requestId"=$1',
    [requestId],
  );
  let revoked = false;
  const snapshot = {
    version: 2,
    activationScopes: ['crm:read', 'crm:write'],
    latestRequestId: requestId,
    recordRoles: {
      actionId,
      readerRoleId: roles.reader,
      writerRoleId: roles.writer,
      personObjectMetadataId: objects.find((o) => o.nameSingular === 'person')
        .id,
      companyObjectMetadataId: objects.find((o) => o.nameSingular === 'company')
        .id,
    },
    requestId,
    companyId,
    subjectId,
    workspaceId,
    clientId: projection.client_id,
    bindingId: projection.binding_id,
    generationId: projection.generation_id,
    authzEpoch: '1',
    audience: 'crm_training',
    activationPolicyRevision: '1',
    currentAccessPolicyRevision: '2',
    payloadSha256: digest(payload),
    identitySha256: 'a'.repeat(64),
    verifiedEmail: projection.verified_email,
    activationParentSessionId: parentId,
    activationParentExp: '2000000000',
    currentParentSessionId: randomUUID(),
    currentParentExp: '2000000000',
    attempt: 1,
    coordinatorId: 'fixture_coordinator',
    receiptSha256: ledger.receiptSha256,
    profileSha256: association.profileSha256,
    databaseAssociationSha256: association.databaseAssociationSha256,
  };
  const authority = {
    assertHeld() {
      if (revoked) throw Error('core-revoked');
    },
    async assertCurrent() {
      this.assertHeld();
      return snapshot;
    },
  };
  const openCurrent = async () => {
    const lock = await adapter.openCurrent(authority, end());
    currentLocks.push(lock);
    return lock;
  };
  let lock = await openCurrent();
  assert.equal((await lock.verifyEditor(authority)).roleId, roles.writer);
  passed.push('exact-ledger-ack-current-correspondence');
  const revoker = admin.createQueryRunner();
  runners.push(revoker);
  await revoker.connect();
  await revoker.startTransaction();
  await revoker.query("SET LOCAL lock_timeout='100ms'");
  for (const sql of [
    'UPDATE core."user" SET disabled=true WHERE id=\'' + userId + "'",
    'DELETE FROM core."roleTarget" WHERE "userWorkspaceId"=\'' +
      userWorkspaceId +
      "'",
    `UPDATE "${schema}"."workspaceMember" SET "deletedAt"=now() WHERE id='${memberId}'`,
    'INSERT INTO core."fieldPermission"("roleId","workspaceId","applicationId","fieldMetadataId") SELECT \'' +
      roles.writer +
      "','" +
      workspaceId +
      "','" +
      applicationId +
      '\',id FROM core."fieldMetadata" LIMIT 1',
  ]) {
    await assert.rejects(revoker.query(sql), (error) => error.code === '55P03');
    await revoker.rollbackTransaction();
    await revoker.startTransaction();
    await revoker.query("SET LOCAL lock_timeout='100ms'");
  }
  await revoker.rollbackTransaction();
  await revoker.release();
  passed.push('native-revocation-and-phantoms-blocked');
  assert.equal(await lock.admit(async () => 'admitted'), 'admitted');
  passed.push('same-native-transaction-provider-admission');
  await lock.close();
  await assert.rejects(lock.verifyEditor(authority));
  // Capture only this disposable fixture's exact runner to simulate server-side
  // abort/replacement without changing the driver's active transaction flag.
  const createReaderRunner = reader.createQueryRunner.bind(reader);
  for (const mode of ['aborted', 'replaced']) {
    let nativeRunner;
    reader.createQueryRunner = (...args) => {
      nativeRunner = createReaderRunner(...args);
      return nativeRunner;
    };
    lock = await openCurrent();
    reader.createQueryRunner = createReaderRunner;
    await lock.verifyEditor(authority);
    if (mode === 'aborted') {
      await assert.rejects(
        nativeRunner.query('SELECT 1/0'),
        (error) => error.code === '22012',
      );
      await assert.rejects(
        lock.verifyIdentity({}),
        (error) => error.code === '25P02',
      );
    } else {
      await nativeRunner.query('ROLLBACK');
      await nativeRunner.query('BEGIN');
    }
    assert.equal(nativeRunner.isTransactionActive, true);
    let providerCalled = false;
    await assert.rejects(
      lock.admit(async () => {
        providerCalled = true;
      }),
    );
    assert.equal(providerCalled, false);
    assert.equal(nativeRunner.isReleased, false);
    await lock.close();
    assert.equal(nativeRunner.isReleased, true);
    passed.push(`actual-${mode}-native-transaction-denies-provider`);
  }
  await admin.query('UPDATE core."user" SET disabled=true WHERE id=$1', [
    userId,
  ]);
  lock = await openCurrent();
  await assert.rejects(lock.verifyEditor(authority));
  await lock.close();
  await admin.query('UPDATE core."user" SET disabled=false WHERE id=$1', [
    userId,
  ]);
  passed.push('revoked-native-user-denied-after-close');
  for (const change of [
    { companyId: randomUUID() },
    { subjectId: randomUUID() },
    { workspaceId: randomUUID() },
    { profileSha256: 'e'.repeat(64) },
    { databaseAssociationSha256: 'f'.repeat(64) },
  ]) {
    await assert.rejects(
      PrivateNativeCurrentIsolation.acquire(
        reader,
        { ...association, ...change },
        authority,
        end(),
      ),
    );
  }
  passed.push('foreign-association-denials');
  lock = await openCurrent();
  revoked = true;
  await assert.rejects(lock.verifyEditor(authority), /core-revoked/);
  await lock.close();
  revoked = false;
  passed.push('core-revocation-denied');
  const old = snapshot.latestRequestId;
  snapshot.latestRequestId = randomUUID();
  lock = await openCurrent();
  await assert.rejects(lock.verifyEditor(authority));
  await lock.close();
  snapshot.latestRequestId = old;
  passed.push('newer-request-quarantine');
  await assert.rejects(
    reader.query('UPDATE core."user" SET disabled=true WHERE id=$1', [userId]),
    (error) => error.code === '42501',
  );
  await assert.rejects(
    reader.query(
      "SELECT core.activate_original_crm_editor_identity('{}'::jsonb,''::bytea)",
    ),
    (error) => error.code === '42501',
  );
  passed.push('reader-cannot-write-or-activate');
  await admin.query(
    'GRANT UPDATE ON core."user" TO exe_crm_native_current_reader',
  );
  await assert.rejects(openCurrent());
  await admin.query(
    'REVOKE UPDATE ON core."user" FROM exe_crm_native_current_reader',
  );
  passed.push('reader-grant-drift-denied');
  const variant = (letter, signal) => {
    const canonical = Buffer.from(
      JSON.stringify({
        subject_id: subjectId,
        verified_email: projection.verified_email,
        email_confirmed_at: projection.email_confirmed_at,
        identity_sha256: letter.repeat(64),
        activation_scopes: projection.activation_scopes,
      }),
    );
    const next = {
      ...projection,
      request_id: randomUUID(),
      identity_sha256: letter.repeat(64),
      payload_sha256: digest(canonical),
      expires_at: new Date(Date.now() + 4500).toISOString(),
    };
    const handle = adapter.createHandle(next, canonical, end(signal));
    handles.push(handle);
    return { next, handle };
  };
  const ledgerCount = async (requestId) =>
    (
      await admin.query(
        'SELECT count(*)::integer AS count FROM core."privateNativeIdentityActivation" WHERE "requestId"=$1',
        [requestId],
      )
    )[0].count;
  const rolled = variant('b');
  await rolled.handle.prepare();
  await rolled.handle.rollback(end());
  await rolled.handle.dispose(end());
  assert.equal(await ledgerCount(rolled.next.request_id), 0);
  passed.push('actual-native-rollback-no-ledger');
  const blocker = admin.createQueryRunner();
  runners.push(blocker);
  await blocker.connect();
  await blocker.startTransaction();
  await blocker.query('LOCK TABLE core."roleTarget" IN SHARE MODE');
  const abort = new AbortController(),
    cancelled = variant('e', abort.signal);
  const preparation = cancelled.handle.prepare();
  // Observe the actual blocked backend before cancellation; no timer alone
  // stands in for lock acquisition or server transaction release.
  let blocked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await admin.query(
      "SELECT pid FROM pg_stat_activity WHERE usename='exe_crm_native_identity_activator' AND wait_event_type='Lock'",
    );
    if (rows.length === 1) {
      blocked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!blocked) {
    await preparation;
    throw Error('Native activation did not block on the held role-target lock');
  }
  abort.abort();
  await assert.rejects(preparation);
  await cancelled.handle.rollback(end());
  await assert.rejects(cancelled.handle.dispose(end()));
  await blocker.rollbackTransaction();
  await blocker.release();
  assert.equal(await ledgerCount(cancelled.next.request_id), 0);
  passed.push('actual-blocked-native-cancellation-no-ledger');
  const createRunner = activator.createQueryRunner.bind(activator);
  activator.createQueryRunner = (...parameters) => {
    const runner = createRunner(...parameters),
      commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = async () => {
      await commit();
      throw Error('fixture dropped COMMIT acknowledgment');
    };
    return runner;
  };
  const lost = variant('f');
  await lost.handle.prepare();
  await assert.rejects(lost.handle.commit(), /dropped COMMIT/);
  await assert.rejects(lost.handle.commit());
  await assert.rejects(lost.handle.dispose(end()));
  await assert.rejects(lost.handle.postCommit(end()));
  assert.equal(await ledgerCount(lost.next.request_id), 1);
  snapshot.latestRequestId = lost.next.request_id;
  lock = await openCurrent();
  await assert.rejects(lock.verifyEditor(authority));
  await lock.close();
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE usename IN('exe_crm_native_current_reader','exe_crm_native_identity_activator') AND xact_start IS NOT NULL",
      )
    )[0].count,
    0,
  );
  passed.push('actual-lost-commit-ack-no-publication-or-historical-fallback');
  console.log(
    JSON.stringify({ passed, fixtureOnly: true, coreAcceptance: false }),
  );
} finally {
  await Promise.allSettled(currentLocks.map((lock) => lock.close()));
  for (const handle of handles) {
    await handle.rollback(end()).catch(() => {});
    await handle.dispose(end()).catch(() => {});
  }
  for (const runner of runners) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    if (!runner.isReleased) await runner.release();
  }
  await Promise.allSettled([
    reader?.isInitialized ? reader.destroy() : null,
    activator?.isInitialized ? activator.destroy() : null,
  ]);
  await admin.destroy();
}
