#!/usr/bin/env node
// Owned native bootstrap and genuine Core private-authority CRM adapter; no production admission.
import { execFileSync, spawnSync } from 'node:child_process';
import { OwnedContainers } from './owned-containers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, statfsSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
export function allocateCRMChain(){const suffix=randomBytes(16).toString('hex');return {suffix,sites:{a:'crm.acl-a-'+suffix.slice(0,12)+'.example.test',b:'crm.acl-b-'+suffix.slice(0,12)+'.example.test'}}}
export async function createCRMChain(allocation,manifestPath,deadline,cleanupDeadline){
const root = mkdtempSync(join(tmpdir(), 'native-crm-baseline-')),
  id = randomUUID(),
  names = [],
  networks = [],
  volumes = [];
const manifest = JSON.parse(
  readFileSync(
    manifestPath,
    'utf8',
  ),
);
const runtimeSource = '22b3a31a201fa12c33916276a738ca99b2403b97';
assert.match(
  runtimeSource ?? '',
  /^[a-f0-9]{40}$/,
  'Explicit exact runtime source SHA required',
);
const image = manifest.images.find(
  (x) => x.kind === 'crm' && x.source_sha === runtimeSource,
)?.image;
if (!image || !/^sha256:[a-f0-9]{64}$/.test(image))
  throw Error('Reviewed CRM image required');
let cleaning = false;
const wholeEnd = deadline;
let phaseEnd = wholeEnd - 60000,
  primary = null;
const secondary = [],
  records = [],
  ownedIds = [];
let rawBytes = 0;
const record = (stdout, stderr, status, signal = null) => {
  const ordinal = records.length + 1;
  const out = Buffer.from(stdout ?? ''),
    err = Buffer.from(stderr ?? '');
  writeFileSync(join(root, ordinal + '.stdout'), out, { mode: 0o600 });
  writeFileSync(join(root, ordinal + '.stderr'), err, { mode: 0o600 });
  rawBytes += out.length + err.length;
  records.push({
    ordinal,
    status,
    signal,
    stdout: out.length,
    stderr: err.length,
  });
  if (!cleaning && rawBytes > 64 * 1024 ** 2)
    throw Error('Fixture raw output bound');
};
const commandTimeout = (maximum) => {
  const remaining = phaseEnd - Date.now();
  if (remaining <= 0) throw Error('Owned fixture phase deadline');
  return Math.min(maximum, remaining);
};
const dockerResult = (args, input, allowFailure = false, timeout = 180000) => {
  const space = statfsSync(root);
  if (!cleaning && space.bavail * space.bsize < 20 * 1024 ** 3)
    throw Error('Owned fixture disk floor');
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: commandTimeout(timeout),
    maxBuffer: 8 * 1024 * 1024,
  });
  record(result.stdout, result.stderr, result.status, result.signal);
  if (result.error || (!allowFailure && result.status !== 0)) {
    const error =
      result.error ?? Error('Owned Docker command failed at ' + records.length);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }
  return result;
};
const docker = (args, input) => dockerResult(args, input).stdout.trim();
const owned = new OwnedContainers(docker);
const anonymousVolumes = new Set();
const create = (args) => {
  const id = owned.create(args);
  ownedIds.push(id);
  // Only this successful returned ID supplies ownership of its anonymous mounts.
  const inspected = JSON.parse(docker(['inspect', id]))[0];
  assert.equal(inspected.Id, id);
  for (const mount of inspected.Mounts ?? []) {
    if (mount.Type === 'volume' && !volumes.includes(mount.Name)) {
      assert.match(mount.Name, /^[a-f0-9]{64}$/);
      anonymousVolumes.add(mount.Name);
    }
  }
  return id;
};
const foreground = (args, input, allowFailure = false) => {
  const id = create([
    'create',
    '--name',
    'native-crm-probe-' + ownedIds.length + '-' + idSuffix,
    '--memory',
    '1g',
    '--pids-limit',
    '128',
    ...args,
  ]);
  return dockerResult(
    [
      'start',
      '--attach',
      ...(input === undefined ? [] : ['--interactive']),
      id,
    ],
    input,
    allowFailure,
    60000,
  );
};
const idSuffix = id;
const foregroundText = (args, input) => foreground(args, input).stdout.trim();
const wait = async (f) => {
  for (let i = 0; i < 180; i++) {
    if (Date.now() >= phaseEnd) throw Error('Owned fixture phase deadline');
    try {
      if (await f()) return;
    } catch (error) {
      if (error.message === 'Owned fixture disk floor') throw error;
    }
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(1, phaseEnd - Date.now()))));
  }
  throw Error('Native service unavailable');
};
const attachments=[],nativeMappings={},hosted={},startedIds=new Map();
let stage = 'setup';
try {
  assert.equal(
    docker([
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.exe.fixture_source_sha"}}',
      image,
    ]),
    runtimeSource,
  );
  assert.equal(
    docker([
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.exe.fixture_scope"}}',
      image,
    ]),
    'dev-dependency-server-only',
  );
  const repository = new URL('../..', import.meta.url).pathname;
  const sourceTree = execFileSync(
    'git',
    [
      '--no-replace-objects',
      '-C',
      repository,
      'rev-parse',
      runtimeSource + '^{tree}',
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.equal(manifest.source_tree, sourceTree);
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.scope, 'dev-dependency-server-only');
  for (const [name, expected] of [
    ['org.exe.fixture_source_tree', sourceTree],
    ['org.exe.fixture_archive_sha256', manifest.archive_sha256],
    ['org.exe.fixture_dockerfile_sha256', manifest.fixture_dockerfile_sha256],
  ]) {
    assert.match(expected, /^[a-f0-9]{40,64}$/);
    assert.equal(
      docker([
        'image',
        'inspect',
        '--format',
        '{{index .Config.Labels "' + name + '"}}',
        image,
      ]),
      expected,
    );
  }
  const sourceLock = execFileSync(
    'git',
    [
      '--no-replace-objects',
      '-C',
      repository,
      'show',
      runtimeSource + ':yarn.lock',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  const sourcePackage = execFileSync(
    'git',
    [
      '--no-replace-objects',
      '-C',
      repository,
      'show',
      runtimeSource + ':packages/twenty-server/package.json',
    ],
    { encoding: 'utf8' },
  );
  const dependencies = JSON.parse(sourcePackage).dependencies;
  const expectedVersions = {};
  for (const name of [
    '@nestjs/core',
    '@nestjs/common',
    '@nestjs/platform-express',
    'typeorm',
    'pg',
    'graphql',
    'express',
    'bullmq',
    'ioredis',
    'jsonwebtoken',
  ]) {
    const declared = dependencies[name];
    assert.equal(typeof declared, 'string');
    const blocks = sourceLock.split(/\n(?="[^\n]+":\n)/);
    const matches = blocks.filter((block) => {
      const header = block.split('\n')[0];
      return (
        header.includes(name + '@npm:' + declared) ||
        header.includes(
          name +
            '@' +
            declared +
            '::locator=twenty-server%40workspace%3Apackages%2Ftwenty-server',
        )
      );
    });
    assert.equal(matches.length, 1);
    expectedVersions[name] = matches[0].match(/\n  version: ([^\n]+)/)?.[1];
    assert.match(expectedVersions[name], /^\d+\.\d+\.\d+/);
  }
  const versions = JSON.parse(
    foregroundText(
      [
        '-i',
        '--network',
        'none',
        '--entrypoint',
        'node',
        image,
        '-e',
        "const fs=require('fs'),p=require('path'),crypto=require('crypto');const expected=JSON.parse(fs.readFileSync(0,'utf8')),versions={};for(const name of Object.keys(expected)){let dir=p.dirname(require.resolve(name));while(true){const file=p.join(dir,'package.json');if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file));if(pkg.name===name){versions[name]=pkg.version;break}}const parent=p.dirname(dir);if(parent===dir)throw Error('Missing native package');dir=parent}}console.log(JSON.stringify({versions,lock:crypto.createHash('sha256').update(fs.readFileSync('/app/yarn.lock')).digest('hex'),uid:process.getuid()}))",
      ],
      JSON.stringify(expectedVersions),
    ),
  );
  assert.deepEqual(versions.versions, expectedVersions);
  assert.equal(versions.uid, 1000);
  assert.equal(
    versions.lock,
    createHash('sha256').update(sourceLock).digest('hex'),
  );
  console.log(
    'PASS compiled server-only fixture: pinned lock and actual native dependency versions match; UID1000; development tooling retained, no production packaging admission.',
  );
  const free = statfsSync(root);
  assert.ok(free.bavail * free.bsize >= 20 * 1024 ** 3);
  const workerRefusal = foreground(
    [
      '--network',
      'none',
      '-e',
      'CRM_COMPANY_MODE=true',
      '-e',
      'DISABLE_DB_MIGRATIONS=true',
      '-e',
      'DISABLE_CRON_JOBS_REGISTRATION=true',
      image,
      'yarn',
      'worker:prod',
    ],
    undefined,
    true,
  );
  assert.notEqual(workerRefusal.status, 0);
  assert.match(
    workerRefusal.stdout + workerRefusal.stderr,
    /Company workers require separately reviewed scoped jobs/,
  );
  const companies = [];
  for (const company of ['a', 'b']) {
    stage = `${company}:init`;
    const network = `native-crm-${company}-${id}`;
    docker(['network', 'create', '--internal', network]);
    networks.push(network);
    const storage = `native-crm-storage-${company}-${id}`;
    docker(['volume', 'create', storage]);
    volumes.push(storage);
    const name = (label) => `native-crm-${company}-${label}-${id}`;
    const start = (label, args) => {
      const n = name(label);
      names.push(n);
      const startedId=create([
        'run',
        '-d',
        '--name',
        n,
        '--label',
        'exe.disposable-native-crm=true',
        '--network',
        network,
        '--pids-limit',
        '128',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        ...args,
      ]);
      startedIds.set(n,startedId);
      return n;
    };
    const secret = randomBytes(32).toString('base64url'),
      nativeDb = randomBytes(32).toString('base64url'),
      redisPassword = randomBytes(32).toString('base64url'),
      app = randomBytes(32).toString('base64url'),
      login = randomBytes(32).toString('base64url');
    const pg = start('pg', [
      '--cap-add',
      'CHOWN',
      '--cap-add',
      'FOWNER',
      '--cap-add',
      'SETUID',
      '--cap-add',
      'SETGID',
      '--cap-add',
      'DAC_OVERRIDE',
      '--network-alias',
      'db',
      '--memory',
      '768m',
      '--cpus',
      '0.5',
      '-e',
      'POSTGRES_USER=fixture_admin',
      '-e',
      `POSTGRES_PASSWORD=${secret}`,
      '-e',
      'POSTGRES_DB=crm',
      'pgvector/pgvector:pg16@sha256:00ba258a66dac104fd5171074a0084462a64a1369d8513f3d0a634e2f24d15bc',
    ]);
    await wait(() =>
      docker([
        'exec',
        pg,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'fixture_admin',
        '-d',
        'crm',
      ]).includes('accepting'),
    );
    // Owned native DB bootstrap only: application never receives the administrator DSN.
    docker(
      [
        'exec',
        '-i',
        pg,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'fixture_admin',
        '-d',
        'crm',
      ],
      `CREATE ROLE crm LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${nativeDb}'; ALTER DATABASE crm OWNER TO crm; CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; GRANT ALL ON SCHEMA public TO crm;`,
    );
    const redis = start('redis', [
      '--user',
      'redis',
      '--network-alias',
      'redis',
      '--memory',
      '128m',
      '--cpus',
      '0.1',
      'redis:7.4-alpine@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99',
      'redis-server',
      '--maxmemory',
      '96mb',
      '--maxmemory-policy',
      'noeviction',
      '--requirepass',
      redisPassword,
    ]);
    const envFile = join(root, `${company}.env`);
    writeFileSync(
      envFile,
      `PG_DATABASE_URL=postgresql://crm:${nativeDb}@db:5432/crm\nREDIS_URL=redis://:${redisPassword}@redis:6379\nAPP_SECRET=${app}\nEXE_LICENSE_KEY=fixture-only-${randomUUID()}\nSERVER_URL=http://crm.${company}.fixture.test\nPUBLIC_DOMAIN_URL=http://crm.${company}.fixture.test\nEXE_CRM_ADMIN_EMAIL=bootstrap-${company}@example.test\nAUTH_PASSWORD_ENABLED=true\nAUTH_GOOGLE_ENABLED=false\nAUTH_MICROSOFT_ENABLED=false\nIS_BILLING_ENABLED=false\nIS_MULTIWORKSPACE_ENABLED=false\nIS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=true\nIS_EMAIL_VERIFICATION_REQUIRED=false\nEMAIL_DRIVER=logger\nTELEMETRY_ENABLED=false\nSTORAGE_TYPE=local\nNODE_PORT=3000\nLOGGER_DRIVER=CONSOLE\n`,
      { mode: 0o600 },
    );
    // Native uid1000 owns this fixture's file volume.
    foregroundText([
      '--network',
      'none',
      '--user',
      '0',
      '-v',
      `${storage}:/storage`,
      '--entrypoint',
      'chown',
      image,
      '1000:1000',
      '/storage',
    ]);
    const server = start('server', [
      '--network-alias',
      'crm',
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--env-file',
      envFile,
      '-v',
      `${storage}:/app/packages/twenty-server/.local-storage`,
      image,
    ]);
    await wait(() => {
      try {
        return (
          docker([
            'exec',
            server,
            'node',
            '-e',
            "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ]) === ''
        );
      } catch {
        return false;
      }
    });
    const worker = start('worker', [
      '--memory',
      '1g',
      '--cpus',
      '0.25',
      '--env-file',
      envFile,
      '-e',
      'DISABLE_DB_MIGRATIONS=true',
      '-e',
      'DISABLE_CRON_JOBS_REGISTRATION=true',
      '-v',
      `${storage}:/app/packages/twenty-server/.local-storage`,
      image,
      'yarn',
      'worker:prod',
    ]);
    const request = (path, query, variables = {}, token) => {
      const body = { query, variables };
      const source =
        "const fs=require('fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));fetch('http://127.0.0.1:3000'+x.path,{method:'POST',headers:{'Content-Type':'application/json',...(x.token?{Authorization:'Bearer '+x.token}:{})},body:JSON.stringify(x.body),signal:AbortSignal.timeout(30000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()}))).catch(()=>process.exit(1))";
      const result = JSON.parse(
        docker(
          ['exec', '-i', server, 'node', '-e', source],
          JSON.stringify({ path, body, token }),
        ),
      );
      if (result.body.errors && stage.includes('native-'))
        console.error(
          'Native GraphQL codes',
          result.status,
          result.body.errors.map((x) => ({
            code: x.extensions?.code ?? 'graphql-validation',
            message: String(x.message ?? '')
              .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
              .slice(0, 180),
          })),
        );
      return result;
    };
    stage = `${company}:native-bootstrap-password`;
    const adminPassword =
      'Synthetic-Admin-2!' + randomBytes(32).toString('base64url');
    const reset = request(
      '/metadata',
      'mutation($email:String!){emailPasswordResetLink(email:$email){success}}',
      { email: `bootstrap-${company}@example.test` },
    );
    assert.equal(reset.body.data?.emailPasswordResetLink?.success, true);
    let resetToken;
    await wait(() => {
      for (const container of [worker]) {
        const captured = spawnSync(
          'docker',
          ['logs', '--tail', '350', container],
          {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            timeout: commandTimeout(10000),
          },
        );
        record(
          captured.stdout,
          captured.stderr,
          captured.status,
          captured.signal,
        );
        resetToken = (captured.stdout + '\n' + captured.stderr).match(
          /reset-password\/([a-f0-9]{64})/,
        )?.[1];
        if (resetToken) return true;
      }
      return false;
    });
    const setPassword = request(
      '/metadata',
      'mutation($token:String!,$password:String!){updatePasswordViaResetToken(passwordResetToken:$token,newPassword:$password){success}}',
      { token: resetToken, password: adminPassword },
    );
    assert.equal(
      setPassword.body.data?.updatePasswordViaResetToken?.success,
      true,
    );
    const signin = request(
      '/metadata',
      'mutation($email:String!,$password:String!){signIn(email:$email,password:$password){availableWorkspaces{availableWorkspacesForSignIn{id loginToken workspaceUrls{customUrl subdomainUrl}}}}}',
      { email: `bootstrap-${company}@example.test`, password: adminPassword },
    );
    assert.ok(!signin.body.errors);
    const bootstrap =
      signin.body.data.signIn.availableWorkspaces
        .availableWorkspacesForSignIn[0];
    assert.ok(bootstrap);
    const adminExchange = request(
      '/metadata',
      'mutation($loginToken:String!,$origin:String!){getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin){tokens{accessOrWorkspaceAgnosticToken{token}refreshToken{token}}}}',
      {
        loginToken: bootstrap.loginToken,
        origin:
          bootstrap.workspaceUrls.customUrl ??
          bootstrap.workspaceUrls.subdomainUrl,
      },
    );
    assert.ok(!adminExchange.body.errors);
    stage = `${company}:native-bootstrap-activation`;
    const adminActivation = request(
      '/metadata',
      'mutation{activateWorkspace(data:{displayName:"Synthetic Operator Bootstrap"}){id activationStatus}}',
      {},
      adminExchange.body.data.getAuthTokensFromLoginToken.tokens
        .accessOrWorkspaceAgnosticToken.token,
    );
    assert.ok(!adminActivation.body.errors);
    assert.equal(
      adminActivation.body.data.activateWorkspace.activationStatus,
      'ACTIVE',
    );
    assert.equal(adminActivation.body.data.activateWorkspace.id, bootstrap.id);
    const adminRenew = request(
      '/metadata',
      'mutation($appToken:String!){renewToken(appToken:$appToken){tokens{accessOrWorkspaceAgnosticToken{token}}}}',
      {
        appToken:
          adminExchange.body.data.getAuthTokensFromLoginToken.tokens
            .refreshToken.token,
      },
    );
    assert.ok(!adminRenew.body.errors);
    stage = `${company}:native-bootstrap-record`;
    const adminRecord = request(
      '/graphql',
      'mutation{createPerson(data:{name:{firstName:"Operator Bootstrap"}}){id}}',
      {},
      adminRenew.body.data.renewToken.tokens.accessOrWorkspaceAgnosticToken
        .token,
    );
    assert.ok(!adminRecord.body.errors);
    assert.ok(adminRecord.body.data.createPerson.id);
    stage = `${company}:native-extra-workspace-denial`;
    const extraSignup = request(
      '/metadata',
      'mutation($email:String!,$password:String!){signUp(email:$email,password:$password){tokens{accessOrWorkspaceAgnosticToken{token}}}}',
      {
        email: `extra-${company}@example.test`,
        password: 'Denied-Workspace-2!' + randomBytes(32).toString('base64url'),
      },
    );
    assert.ok(extraSignup.body.errors?.length);
    const extraWorkspace = request(
      '/metadata',
      'mutation{signUpInNewWorkspace{workspace{id}}}',
      {},
      adminRenew.body.data.renewToken.tokens.accessOrWorkspaceAgnosticToken
        .token,
    );
    assert.ok(extraWorkspace.body.errors?.length);
    const current = request(
      '/metadata',
      'mutation($email:String!,$password:String!){signIn(email:$email,password:$password){availableWorkspaces{availableWorkspacesForSignIn{id}}}}',
      { email: `bootstrap-${company}@example.test`, password: adminPassword },
    );
    assert.ok(!current.body.errors);
    assert.equal(
      current.body.data.signIn.availableWorkspaces.availableWorkspacesForSignIn
        .length,
      1,
    );
    assert.equal(
      current.body.data.signIn.availableWorkspaces
        .availableWorkspacesForSignIn[0].id,
      bootstrap.id,
    );
    const workspace = { id: bootstrap.id };
    const token =
      adminRenew.body.data.renewToken.tokens.accessOrWorkspaceAgnosticToken
        .token;
    stage = `${company}:native-bootstrap-record-removal`;
    const removedAdmin = request(
      '/graphql',
      'mutation($id:UUID!){deletePerson(id:$id){id}}',
      { id: adminRecord.body.data.createPerson.id },
      token,
    );
    assert.ok(!removedAdmin.body.errors);
    assert.equal(removedAdmin.body.data.deletePerson.id, adminRecord.body.data.createPerson.id);
    const absentAdmin = request(
      '/graphql',
      'query($id:UUID!){person(filter:{id:{eq:$id}}){id}}',
      { id: adminRecord.body.data.createPerson.id },
      token,
    );
    assert.equal(absentAdmin.status, 200);
    assert.deepEqual(absentAdmin.body, {
      errors: [{
        message: 'Record not found',
        extensions: {
          subCode: 'RECORD_NOT_FOUND',
          userFriendlyMessage: 'This record does not exist or has been deleted.',
          code: 'NOT_FOUND',
        },
      }],
      data: { person: null },
    });
    stage = `${company}:native-stock-record-removal`;
    const stockIds = [
      'a2e78a5e-338b-46df-8811-fa08c7d19d35',
      '93c72d2e-e65c-44c4-99ad-f87f50349dcf',
      'edf6d445-13a7-4373-9a47-8f89e8c0a877',
      'b1e26fa6-c757-4c88-abfa-4b11f5cf3acf',
      '7a93d1e5-3f74-4945-8a65-d7f996083f72',
    ].sort();
    assert.deepEqual(activePeopleIds({ pg, workspace }), stockIds);
    for (const id of stockIds) {
      const removed = request(
        '/graphql',
        'mutation($id:UUID!){deletePerson(id:$id){id}}',
        { id },
        token,
      );
      assert.equal(removed.status, 200);
      assert.ok(!removed.body.errors);
      assert.equal(removed.body.data.deletePerson.id, id);
    }
    assert.deepEqual(activePeopleIds({ pg, workspace }), []);
    stage = `${company}:native-record`;
    const contact = request(
      '/graphql',
      'mutation{createPerson(data:{name:{firstName:"Fixture",lastName:"' +
        company.toUpperCase() +
        '"}}){id name{firstName lastName}}}',
      {},
      token,
    );
    assert.ok(!contact.body.errors);
    const own = request(
      '/graphql',
      'query($id:UUID!){person(filter:{id:{eq:$id}}){id name{firstName lastName}}}',
      { id: contact.body.data.createPerson.id },
      token,
    );
    assert.ok(!own.body.errors);
    assert.equal(own.body.data.person.name.lastName, company.toUpperCase());
    const updated = request(
      '/graphql',
      'mutation($id:UUID!){updatePerson(id:$id,data:{jobTitle:"Synthetic Updated"}){id jobTitle}}',
      { id: contact.body.data.createPerson.id },
      token,
    );
    assert.ok(!updated.body.errors);
    assert.equal(updated.body.data.updatePerson.jobTitle, 'Synthetic Updated');
    const temporary = request(
      '/graphql',
      'mutation{createPerson(data:{name:{firstName:"Temporary"}}){id}}',
      {},
      token,
    );
    assert.ok(!temporary.body.errors);
    const deleted = request(
      '/graphql',
      'mutation($id:UUID!){deletePerson(id:$id){id}}',
      { id: temporary.body.data.createPerson.id },
      token,
    );
    assert.ok(!deleted.body.errors);
    assert.equal(
      deleted.body.data.deletePerson.id,
      temporary.body.data.createPerson.id,
    );
    const info = request(
      '/graphql',
      'mutation{createCompany(data:{name:"Synthetic ' +
        company.toUpperCase() +
        '"}){id name}}',
      {},
      token,
    );
    assert.ok(!info.body.errors);
    companies.push({
      company,
      server,
      worker,
      pg,
      redis,
      flushOwnedFeatureFlagCache: () =>
        docker([
          'exec',
          '-e',
          'REDISCLI_AUTH=' + redisPassword,
          redis,
          'redis-cli',
          '--no-auth-warning',
          'DEL',
          'engine:workspace:feature-flag:feature-flags-map:' +
            workspace.id +
            ':data',
          'engine:workspace:feature-flag:feature-flags-map:' +
            workspace.id +
            ':hash',
        ]),
      network,
      storage,
      workspace,
      token,
      contact: contact.body.data.createPerson,
      info: info.body.data.createCompany,
      request,
      envFile,
      start,
    });
  }
  for (const x of companies) {
    const added = x.request('/graphql', 'mutation{createPerson(data:{name:{firstName:"Restricted",lastName:"Fixture"},jobTitle:"Restricted"}){id}}', {}, x.token);
    assert.equal(added.status, 200);
    assert.ok(!added.body.errors);
    x.restricted = added.body.data.createPerson;
    assert.ok(x.restricted.id);
    assert.deepEqual(activePeopleIds(x), [x.contact.id, x.restricted.id].sort());
    docker(['stop', x.worker, x.server]);
  }
  return {output:root,workspaces:Object.fromEntries(companies.map(x=>[x.company,x.workspace.id])),
    async prepare(nativeID,profiles,secrets,bootstrap,authOrigin) {
      assert.match(nativeID,/^[a-f0-9]{64}$/);
      for(const x of companies) {
        const profile=profiles[x.company];assert.equal(profile.native_id,x.workspace.id);
        docker(['network','connect','--alias','core-native',x.network,nativeID]);attachments.push({network:x.network,id:nativeID});
        const topology=JSON.parse(docker(['inspect',nativeID]))[0];assert.equal(topology.Id,nativeID);assert.ok(topology.NetworkSettings.Networks[x.network]);
        const privateVolume='native-crm-private-'+x.company+'-'+id;docker(['volume','create',privateVolume]);volumes.push(privateVolume);
        const env=readFileSync(x.envFile,'utf8');const dbURL=env.match(/^PG_DATABASE_URL=(.+)$/m)[1];
        const operatorPath=new URL('./real-issuer-chain.integration.mjs',import.meta.url).pathname;
        const prepared=JSON.parse(foregroundText(['-i','--network',x.network,'--user','1000','-v',operatorPath+':/fixture/operator.mjs:ro','--entrypoint','node',image,'/fixture/operator.mjs'],JSON.stringify({operation:'provision',profile,secret:secrets[x.company],bootstrap:bootstrap[x.company],database:dbURL,workspace_id:x.workspace.id})));
        assert.equal(prepared.workspace_id,x.workspace.id);assert.equal(prepared.native_role.rolsuper,false);assert.equal(prepared.native_role.rolbypassrls,false);assert.equal(prepared.bindings.length,x.company==='a'?2:1);nativeMappings[x.company]=prepared;
        const flow=randomBytes(32).toString('base64url'),mapping=JSON.stringify(prepared.bindings);
        foregroundText(['-i','--network','none','--user','0','--entrypoint','node','-v',privateVolume+':/private',image,'-e',"const fs=require('fs');for(const [n,v]of Object.entries(JSON.parse(fs.readFileSync(0,'utf8')))){fs.writeFileSync('/private/'+n,v,{mode:0o600});fs.chownSync('/private/'+n,1000,1000)}"],JSON.stringify({client:secrets[x.company],bindings:mapping,flow}));
        const cleared=env.replace(/^EXE_LICENSE_KEY=.*\n/m,'').replace(/^AUTH_PASSWORD_ENABLED=.*\n/m,'');writeFileSync(x.envFile,cleared+`\nCRM_COMPANY_MODE=true\nCRM_COMPANY_BROWSER_ENABLED=true\nCRM_COMPANY_AUTH_ORIGIN=${authOrigin}\nCRM_COMPANY_FLOW_SECRET_FILE=/private/flow\nCRM_COMPANY_ID=${profile.company_id}\nCRM_COMPANY_WORKSPACE_ID=${x.workspace.id}\nCRM_COMPANY_NATIVE_SCHEMA=${prepared.schema}\nCRM_COMPANY_BINDING_ID=${profile.binding_id}\nCRM_COMPANY_GENERATION_ID=${profile.generation_id}\nCRM_COMPANY_CLIENT_ID=${profile.client_id}\nCRM_COMPANY_AUDIENCE=${profile.audience}\nCRM_COMPANY_ORIGIN=${new URL(profile.callback).origin}\nCRM_COMPANY_BROKER_URL=http://core-native:8097\nCRM_COMPANY_AUTHORITY_URL=http://core-native:8097\nCRM_COMPANY_CLIENT_SECRET_FILE=/private/client\nCRM_COMPANY_BINDINGS_FILE=/private/bindings\nCRM_COMPANY_BINDINGS_SHA256=${createHash('sha256').update(mapping).digest('hex')}\nDISABLE_DB_MIGRATIONS=true\nDISABLE_CRON_JOBS_REGISTRATION=true\nAUTH_PASSWORD_ENABLED=false\n`,{mode:0o600});
        // Real flag prerequisite before the new process computes its cache.
        sql(x,`INSERT INTO core."featureFlag"(id,"workspaceId",key,value) VALUES('${randomUUID()}','${x.workspace.id}','IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED',true) ON CONFLICT ("key","workspaceId") DO UPDATE SET value=true,"updatedAt"=now();`);assert.equal(sql(x,`SELECT value FROM core."featureFlag" WHERE "workspaceId"='${x.workspace.id}' AND key='IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED';`),'t');assert.match(x.flushOwnedFeatureFlagCache(),/^[012]$/);
        hosted[x.company]=x.start('hosted',['--network-alias','hosted','--memory','1g','--cpus','1','--env-file',x.envFile,'-v',x.storage+':/app/packages/twenty-server/.local-storage','-v',privateVolume+':/private:ro',image]);
        try {
          // In company mode, exact intentional denial proves mounted hardened ingress.
          const deniedHealthProbe="const fs=require('fs'),http=require('http');const x=JSON.parse(fs.readFileSync(0,'utf8'));let timer;const q=http.request({hostname:'127.0.0.1',port:3000,path:'/healthz',method:'GET',headers:{Host:x.host,Origin:x.origin}},r=>{let n=0,b='';const headers=r.headers['content-type']==='application/json; charset=utf-8'&&r.headers['content-encoding']===undefined&&r.headers['cache-control']==='no-store'&&r.headers.location===undefined;r.on('data',v=>{n+=v.length;if(n>256)q.destroy(Error('body bound'));else b+=v.toString('utf8')});r.on('error',()=>{clearTimeout(timer);process.exitCode=1});r.on('end',()=>{clearTimeout(timer);console.log(JSON.stringify({status:r.statusCode,body:b}));if(!headers||r.statusCode!==403||b!==\"{\\\"error\\\":\\\"company_route_unavailable\\\"}\")process.exitCode=1})});q.on('error',()=>{clearTimeout(timer);process.exitCode=1});timer=setTimeout(()=>q.destroy(Error('deadline')),2000);q.end()";
          const hostedOrigin=new URL(profile.callback).origin;
          await wait(()=>{
            const response=JSON.parse(docker(['exec','-i',hosted[x.company],'node','-e',deniedHealthProbe],JSON.stringify({host:new URL(hostedOrigin).host,origin:hostedOrigin})));
            assert.deepEqual(response,{status:403,body:"{\"error\":\"company_route_unavailable\"}"});
            return true;
          });
        } catch (error) {
          // Capture only this successfully returned owned container before removal.
          primary ??= {stage:x.company+':hosted-readiness',class:error.constructor.name,message:error.message};
          try {
            const containerId=startedIds.get(hosted[x.company]);
            assert.match(containerId,/^[a-f0-9]{64}$/);
            assert.ok(ownedIds.includes(containerId));
            const captured=spawnSync('docker',['logs','--tail','180',containerId],{
              encoding:'utf8',maxBuffer:128*1024,timeout:commandTimeout(10000),
            });
            record(captured.stdout,captured.stderr,captured.status,captured.signal);
            if(captured.error || captured.status!==0) {
              const diagnostic=captured.error ?? Error('Owned startup log capture failed');
              diagnostic.status=captured.status;
              throw diagnostic;
            }
          } catch (diagnostic) {
            secondary.push({stage:x.company+':hosted-startup-logs',class:diagnostic.constructor.name,status:diagnostic.status??null});
          }
          throw error;
        }
      }
      return nativeMappings;
    },
    call(label,path,cookie='',method='GET') {
      assert.ok(['a','b'].includes(label));const profileOrigin='https://crm.acl-'+label+'-'+allocation.suffix.slice(0,12)+'.example.test';
      const script="const fs=require('fs'),http=require('http');const x=JSON.parse(fs.readFileSync(0,'utf8'));let timer;const q=http.request({hostname:'127.0.0.1',port:3000,path:x.path,method:x.method,headers:{Host:x.host,Origin:x.origin,...(x.cookie?{Cookie:x.cookie}:{})}},r=>{let b='',n=0;r.on('data',v=>{n+=v.length;if(n>262144)q.destroy(Error('body bound'));else b+=v});r.on('end',()=>{clearTimeout(timer);console.log(JSON.stringify({status:r.statusCode,headers:r.headers,body:b}))})});q.on('error',()=>{clearTimeout(timer);process.exitCode=1});timer=setTimeout(()=>q.destroy(Error('deadline')),15000);q.end()";
      return JSON.parse(docker(['exec','-i',hosted[label],'node','-e',script],JSON.stringify({path,method,cookie,host:new URL(profileOrigin).host,origin:profileOrigin})));
    },
    role(label,subject,restore) {
      const x=companies.find(c=>c.company===label),m=nativeMappings[label],entry=m.bindings.find(e=>e.subject_id===subject);assert.ok(entry);
      const role=m.roles[subject];assert.match(role,/^[a-f0-9-]{36}$/);
      if(restore)sql(x,`INSERT INTO core."roleTarget"(id,"universalIdentifier","applicationId","workspaceId","roleId","userWorkspaceId") VALUES('${randomUUID()}','${randomUUID()}','${m.application_id}','${x.workspace.id}','${role}','${entry.user_workspace_id}');`);
      else sql(x,`DELETE FROM core."roleTarget" WHERE "workspaceId"='${x.workspace.id}' AND "roleId"='${role}' AND "userWorkspaceId"='${entry.user_workspace_id}';`);
    },close:cleanup};
} catch(error) { primary={stage,class:error.constructor.name,message:error.message};try{await cleanup()}catch(close){error.cleanup=secondary}throw error; }
function activePeopleIds(x) {
  assert.match(x.workspace.id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const schema = sql(x, `SELECT "databaseSchema" FROM core.workspace WHERE id='${x.workspace.id}' AND "deletedAt" IS NULL;`).trim();
  assert.match(schema, /^[a-z_][a-z0-9_]{0,62}$/);
  const ids = JSON.parse(sql(x, `SELECT COALESCE(json_agg(id ORDER BY id), '[]'::json) FROM "${schema}".person WHERE "deletedAt" IS NULL;`).trim());
  assert.ok(Array.isArray(ids));
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  return ids.sort();
}
function sql(x,text){return docker(['exec','-i',x.pg,'psql','-v','ON_ERROR_STOP=1','-At','-U','fixture_admin','-d','crm'],text)}
async function cleanup(){
 cleaning=true;phaseEnd=cleanupDeadline();
 const attempt=(stage,fn)=>{try{fn()}catch(e){secondary.push({stage,class:e.constructor.name,status:e.status??null})}};
 attempt('containers-remove',()=>owned.removeAll());
 const absent=(args,message)=>{const r=dockerResult(args,undefined,true,10000);assert.ok(Number.isInteger(r.status)&&r.status>0&&r.signal===null&&!r.error&&r.stderr.includes(message))};
 for(const id of ownedIds)attempt('container-absence',()=>absent(['inspect',id],'No such object'));
 for(const v of anonymousVolumes)attempt('anonymous-absence',()=>absent(['volume','inspect',v],v+': no such volume'));
 for(const v of volumes)attempt('named-volume',()=>{docker(['volume','rm',v]);absent(['volume','inspect',v],v+': no such volume')});
 for(const a of attachments)attempt('core-detach',()=>{docker(['network','disconnect',a.network,a.id]);const row=JSON.parse(docker(['inspect',a.id]))[0];assert.equal(row.Id,a.id);assert.ok(!row.NetworkSettings.Networks[a.network])});
 for(const n of networks)attempt('network',()=>{docker(['network','rm',n]);absent(['network','inspect',n],'network '+n+' not found')});
 writeFileSync(join(root,'result.json'),JSON.stringify({scope:'genuine Core opaque identity/current authority and real CRM REST/native; controlled commerce/technical',primary,secondary,ownedIds,volumes,anonymousVolumes:[...anonymousVolumes],networks,rawBytes,records,nativeMappings},null,2),{mode:0o600});
 if(secondary.length)throw Error('Owned CRM cleanup failed');
}
}
