#!/usr/bin/env node
// Actual native ORM ACL fixture with private synthetic company authority; no production admission.
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { OwnedContainers } from './owned-containers.mjs';
import { readFileSync, writeFileSync, mkdtempSync, statfsSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = mkdtempSync(join(tmpdir(), 'native-crm-baseline-')),
  id = randomUUID(),
  names = [],
  networks = [],
  volumes = [];
const manifest = JSON.parse(
  readFileSync(
    process.argv[2] ?? '/tmp/exe-owned-crm-company-images.json',
    'utf8',
  ),
);
const runtimeSource = process.argv[3];
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
const wholeEnd = Date.now() + 30 * 60000;
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
// Stock node:http preserves an explicitly supplied Host; global fetch may replace it.
const nativeHttpScript =
  "const fs=require('fs'),http=require('http');const x=JSON.parse(fs.readFileSync(0,'utf8'));let timer;const req=http.request({hostname:'127.0.0.1',port:3000,path:x.path,method:x.method??'GET',headers:x.headers},res=>{let bytes=0,body='';res.setEncoding('utf8');res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>262144){req.destroy(Error('Native response bound'));return}body+=part});res.on('error',()=>req.destroy(Error('Native response unavailable')));res.on('end',()=>{clearTimeout(timer);try{console.log(JSON.stringify({status:res.statusCode,body:JSON.parse(body)}))}catch{process.exitCode=1}})});req.on('error',()=>{clearTimeout(timer);process.exitCode=1});timer=setTimeout(()=>req.destroy(Error('Native request deadline')),15000);req.end()";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextRateWindow = async () => {
  if (Date.now() + 60050 >= phaseEnd)
    throw Error('Fixture rate-window deadline');
  console.log(
    'Pacing independent assertion group across unchanged 60s credential rate window',
  );
  await pause(60050);
};
const wait = async (f) => {
  for (let i = 0; i < 180; i++) {
    try {
      if (await f()) return;
    } catch (error) {
      if (error.message === 'Owned fixture disk floor') throw error;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Native service unavailable');
};
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
      create([
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
  stage = 'company-authority-native-acl';
  phaseEnd = Math.min(wholeEnd - 60000, Date.now() + 10 * 60000);
  for (const x of companies) {
    docker(['stop', x.worker, x.server]);
    const sql = (text) =>
      docker(
        [
          'exec',
          '-i',
          x.pg,
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          '-U',
          'fixture_admin',
          '-d',
          'crm',
        ],
        text,
      );
    // Actual prerequisite, not a substituted feature map. Both bootstrap
    // processes are stopped above; a new hosted process has no local cache.
    sql(
      `INSERT INTO core."featureFlag"(id,"workspaceId",key,value) VALUES('${randomUUID()}','${x.workspace.id}','IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED',true) ON CONFLICT ("key","workspaceId") DO UPDATE SET value=true,"updatedAt"=now();`,
    );
    assert.equal(
      sql(
        `SELECT value FROM core."featureFlag" WHERE "workspaceId"='${x.workspace.id}' AND key='IS_ROW_LEVEL_PERMISSION_PREDICATES_ENABLED';`,
      ),
      't',
    );
    // Exact two Redis keys used by WorkspaceCacheService.flush('featureFlagsMap')
    // → CacheStorageService.mdel; no wildcard/FLUSHDB or other workspace/cache.
    assert.match(x.flushOwnedFeatureFlagCache(), /^[012]$/);
    const identity = JSON.parse(
      sql(
        `SELECT row_to_json(t) FROM (SELECT u.id AS user_id,uw.id AS user_workspace_id,w.id AS workspace_id,w."databaseSchema" AS schema,rt."roleId" AS role_id,rt."applicationId" AS application_id FROM core."user" u JOIN core."userWorkspace" uw ON uw."userId"=u.id JOIN core.workspace w ON w.id=uw."workspaceId" JOIN core."roleTarget" rt ON rt."userWorkspaceId"=uw.id WHERE u.email='bootstrap-${x.company}@example.test') t;`,
      ),
    );
    assert.equal(identity.workspace_id, x.workspace.id);
    const memberId = sql(
      `SELECT id FROM "${identity.schema}"."workspaceMember" WHERE "userId"='${identity.user_id}' AND "deletedAt" IS NULL;`,
    );
    const subject = randomUUID(),
      companyId = randomUUID(),
      bindingId = randomUUID(),
      generationId = randomUUID(),
      clientId = 'crm-' + x.company,
      clientSecret = randomBytes(32).toString('base64url');
    const envelope = {
      version: 1,
      subject_id: subject,
      company_id: companyId,
      product: 'crm',
      resource_kind: 'crm-workspace',
      binding_id: bindingId,
      native_id: x.workspace.id,
      generation_id: generationId,
      authz_epoch: '1',
      audience: clientId,
      scopes: ['crm:read'],
      current_role: 'owner',
      technical_status: 'accepted',
      subscription_entitled: true,
    };
    const key = 'exk_' + randomBytes(32).toString('base64url'),
      session = 'exs_' + randomBytes(32).toString('base64url');
    const mapping = JSON.stringify([
      {
        subject_id: subject,
        user_id: identity.user_id,
        user_workspace_id: identity.user_workspace_id,
        workspace_member_id: memberId,
      },
    ]);
    const privateVolume = 'native-crm-private-' + x.company + '-' + id;
    docker(['volume', 'create', privateVolume]);
    volumes.push(privateVolume);
    foregroundText(
      [
        '-i',
        '--network',
        'none',
        '--user',
        '0',
        '--entrypoint',
        'node',
        '-v',
        privateVolume + ':/private',
        image,
        '-e',
        "const fs=require('fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));for(const [name,value]of Object.entries(x)){fs.writeFileSync('/private/'+name,value,{mode:0o600});fs.chownSync('/private/'+name,1000,1000)}",
      ],
      JSON.stringify({
        client: clientSecret,
        bindings: mapping,
        envelope: JSON.stringify(envelope),
      }),
    );
    const authorityScript = join(root, 'authority-' + x.company + '.mjs');
    writeFileSync(
      authorityScript,
      `import http from 'node:http';import fs from 'node:fs';import {createHash} from 'node:crypto';const keys={api_key:'${createHash('sha256').update(key).digest('hex')}',session_token:'${createHash('sha256').update(session).digest('hex')}'};let envelope=JSON.parse(fs.readFileSync('/private/envelope'));let status=200,blocked=false,pending=[],raw=null,redirectHits=0,calls=0,blockAt=null;const expected='Basic '+Buffer.from('${clientId}:'+fs.readFileSync('/private/client','utf8')).toString('base64');const send=res=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(status===302?{Location:'http://authority:8095/redirect-trap'}:{})});res.end(raw??JSON.stringify(status===200?envelope:{error:{code:'unavailable'}}))};http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const data=JSON.parse(body||'{}');if(req.url==='/redirect-trap'){redirectHits++;res.end('{}');return}if(req.url==='/fixture/control'){if(data.reset_calls===true){if(pending.length)throw Error('Pending request prevents counter reset');calls=0}if(Object.hasOwn(data,'block_at')){if(data.block_at!==null&&data.block_at!==5)throw Error('Fixed final ordinal required');blockAt=data.block_at}if(Object.hasOwn(data,'envelope'))envelope=data.envelope;if(Object.hasOwn(data,'raw'))raw=data.raw;if(data.status)status=data.status;blocked=!!data.blocked;if(!blocked&&blockAt===null){for(const response of pending)send(response);pending=[]}res.end(JSON.stringify({pending:pending.length,redirect_hits:redirectHits,calls}));return}if(req.headers.authorization!==expected||!['/internal/company-authority/key-introspect','/internal/session-broker/introspect'].includes(req.url)){res.writeHead(401);res.end('{}');return}const field=req.url==='/internal/company-authority/key-introspect'?'api_key':'session_token';const credential=data[field];const pattern=field==='api_key'?/^exk_[A-Za-z0-9_-]{43}$/:/^exs_[A-Za-z0-9_-]{43}$/;if(Object.keys(data).length!==1||typeof credential!=='string'||!pattern.test(credential)||keys[field]!==createHash('sha256').update(credential).digest('hex')){res.writeHead(401);res.end('{}');return}calls++;if(blocked||calls===blockAt){pending.push(res);return}send(res)}).listen(8095,'0.0.0.0')`,
    );
    const authority = x.start('authority', [
      '--network-alias',
      'authority',
      '--memory',
      '128m',
      '--entrypoint',
      'node',
      '-v',
      privateVolume + ':/private:ro',
      '-v',
      authorityScript + ':/fixture/authority.mjs:ro',
      image,
      '/fixture/authority.mjs',
    ]);
    const control = (value) =>
      JSON.parse(
        docker(
          [
            'exec',
            '-i',
            authority,
            'node',
            '-e',
            "const fs=require('fs');fetch('http://127.0.0.1:8095/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:fs.readFileSync(0,'utf8')}).then(async r=>console.log(await r.text()))",
          ],
          JSON.stringify(value),
        ),
      );
    await wait(() => control({ status: 200 }).pending === 0);
    const origin = 'https://crm.' + x.company + '.fixture.test';
    const hostedEnv = join(root, 'hosted-' + x.company + '.env');
    writeFileSync(
      hostedEnv,
      readFileSync(x.envFile, 'utf8')
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('EXE_LICENSE_KEY=') &&
            !line.startsWith('SERVER_URL=') &&
            !line.startsWith('PUBLIC_DOMAIN_URL='),
        )
        .join('\n') +
        `\nSERVER_URL=${origin}\nPUBLIC_DOMAIN_URL=${origin}\nCRM_COMPANY_MODE=true\nCRM_COMPANY_ID=${companyId}\nCRM_COMPANY_WORKSPACE_ID=${x.workspace.id}\nCRM_COMPANY_NATIVE_SCHEMA=${identity.schema}\nCRM_COMPANY_BINDING_ID=${bindingId}\nCRM_COMPANY_GENERATION_ID=${generationId}\nCRM_COMPANY_CLIENT_ID=${clientId}\nCRM_COMPANY_AUDIENCE=${clientId}\nCRM_COMPANY_ORIGIN=${origin}\nCRM_COMPANY_BROKER_URL=http://authority:8095\nCRM_COMPANY_AUTHORITY_URL=http://authority:8095\nCRM_COMPANY_CLIENT_SECRET_FILE=/private/client\nCRM_COMPANY_BINDINGS_FILE=/private/bindings\nCRM_COMPANY_BINDINGS_SHA256=${createHash('sha256').update(mapping).digest('hex')}\nDISABLE_DB_MIGRATIONS=true\nDISABLE_CRON_JOBS_REGISTRATION=true\n`,
      { mode: 0o600 },
    );
    const hosted = x.start('hosted-server', [
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--env-file',
      hostedEnv,
      '-v',
      privateVolume + ':/private:ro',
      '-v',
      x.storage + ':/app/packages/twenty-server/.local-storage',
      image,
    ]);

    const get = (
      path = '/rest/people?depth=0&limit=100',
      headers = { Authorization: 'Bearer ' + key },
      method = 'GET',
    ) =>
      JSON.parse(
        docker(
          ['exec', '-i', hosted, 'node', '-e', nativeHttpScript],
          JSON.stringify({
            path,
            method,
            headers: { Host: new URL(origin).host, Origin: origin, ...headers },
          }),
        ),
      );
    await wait(() => get('/unknown', {}).status === 403);
    const upgradeClosed = docker(
      [
        'exec',
        '-i',
        hosted,
        'node',
        '-e',
        "const net=require('net'),fs=require('fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));const s=net.connect(3000,'127.0.0.1');let data='';s.on('error',()=>{});s.on('data',b=>data+=b);s.on('close',()=>{console.log(data.startsWith('HTTP/1.1 101')?'upgraded':'denied')});s.setTimeout(3000,()=>s.destroy());s.on('connect',()=>s.write('GET /realtime HTTP/1.1\\r\\nHost: '+x.host+'\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: SGVsbG93b3JsZGhlbGxvIQ==\\r\\nCookie: __Host-exe_crm_session='+x.session+'\\r\\n\\r\\n'))",
      ],
      JSON.stringify({ host: new URL(origin).host, session }),
    );
    assert.equal(upgradeClosed, 'denied');
    control({ reset_calls: true });
    const own = get();
    assert.equal(
      control({}).calls,
      5,
      'Successful current list request must traverse exact five authority calls',
    );
    assert.equal(own.status, 200);
    assert.equal(
      own.body.data.people.find((row) => row.id === x.contact.id)?.jobTitle,
      'Synthetic Updated',
    );
    const ownRecord = get(
      '/rest/people/' + x.contact.id + '?depth=0&limit=100',
    );
    assert.equal(ownRecord.status, 200);
    assert.equal(ownRecord.body.data.person.id, x.contact.id);
    assert.equal(ownRecord.body.data.person.jobTitle, 'Synthetic Updated');
    const ownCompanies = get('/rest/companies?depth=0&limit=100');
    assert.equal(ownCompanies.status, 200);
    assert.ok(
      ownCompanies.body.data.companies.some((row) => row.id === x.info.id),
    );
    assert.equal(
      get('/rest/companies/' + x.info.id + '?depth=0&limit=100').body.data
        .company.id,
      x.info.id,
    );
    assert.equal(
      get(undefined, {
        Authorization: 'Bearer ' + key,
        Host: 'crm.foreign.fixture.test',
      }).status,
      403,
    );
    assert.equal(
      get(undefined, {
        Authorization: 'Bearer ' + key,
        Origin: 'https://foreign.fixture.test',
      }).status,
      403,
    );
    const spoofed = get(undefined, {
      Authorization: 'Bearer ' + key,
      'X-User-Id': randomUUID(),
      'X-Workspace-Id': randomUUID(),
      'X-Admin-Token': 'not-authority',
      'X-Forwarded-Authorization': 'Bearer ' + x.token,
    });
    assert.equal(spoofed.status, 200);
    assert.ok(spoofed.body.data.people.some((row) => row.id === x.contact.id));
    assert.equal(
      get(undefined, {
        Cookie:
          'exe_sess=parent; exe_sess_refresh=refresh; __Host-exe_crm_session=' +
          session,
      }).status,
      200,
    );
    for (const headers of [
      { Authorization: 'Bearer ' + x.token },
      { Cookie: 'exe_sess=' + x.token },
      { Authorization: 'Bearer native-key' },
      {},
      {
        Cookie: '__Host-exe_crm_session=' + session,
        Authorization: 'Bearer ' + key,
      },
      { Cookie: '__Host-exe_crm_session=' + x.token },
      {
        Cookie:
          '__Host-exe_crm_session=' +
          session +
          '; __Host-exe_crm_session=' +
          session,
      },
    ])
      assert.ok([401, 403].includes(get(undefined, headers).status));
    for (const path of [
      '/graphql',
      '/rest/people?depth=0',
      '/rest/people?limit=100',
      '/rest/people?depth=0&limit=100&limit=100',
      '/rest/people?depth=0&limit=101',
      '/rest/people?depth=0&limit=100&fields=name',
      '/metadata',
      '/rest/people?depth=1&limit=100',
      '/files/known',
      '/mcp',
      '/rest/people?depth=0&limit=100&workspaceId=' + x.workspace.id,
    ])
      assert.equal(get(path).status, 403);
    assert.equal(
      get('/rest/people?depth=0&limit=100', undefined, 'POST').status,
      403,
    );
    await nextRateWindow();
    for (const invalid of [
      { version: 2 },
      { company_id: randomUUID() },
      { binding_id: randomUUID() },
      { generation_id: randomUUID() },
      { product: 'wiki' },
      { resource_kind: 'wiki-instance' },
      { authz_epoch: '0' },
      { current_role: ['owner'] },
      { current_role: 'admin' },
      { scopes: ['crm:read', 'crm:write'] },
      { unknown: 'unexpected' },
      { native_id: randomUUID() },
      { subject_id: randomUUID() },
      { technical_status: 'unverified' },
      { subscription_entitled: false },
      { audience: 'dashboard' },
    ]) {
      control({ envelope: { ...envelope, ...invalid } });
      assert.ok([401, 403].includes(get().status));
    }
    for (const invalid of [
      null,
      [],
      { ...envelope, subject_id: 'not-a-subject' },
    ]) {
      control({ envelope: invalid });
      assert.ok([401, 403].includes(get().status));
    }
    const assertInitialAuthorityError = (response, status) => {
      assert.equal(response.status, status);
      assert.deepEqual(response.body, {
        statusCode: status,
        messages: [
          status === 401
            ? 'Company authorization denied'
            : 'Company authorization unavailable',
        ],
        error: 'INTERNAL_SERVER_ERROR',
      });
      assert.equal(Object.hasOwn(response.body, 'data'), false);
    };
    for (const status of [401, 403, 404, 503]) {
      control({ envelope, status });
      assertInitialAuthorityError(
        get(),
        status === 401 || status === 403 ? 401 : 503,
      );
    }
    control({ status: 200, raw: '{malformed' });
    assertInitialAuthorityError(get(), 503);
    control({ raw: null, status: 302 });
    assertInitialAuthorityError(get(), 503);
    assert.equal(control({ status: 200 }).redirect_hits, 0);
    control({ blocked: true });
    assertInitialAuthorityError(get(), 503);
    control({ blocked: false });
    assert.equal(get().status, 200);
    await nextRateWindow();
    sql(`UPDATE core."user" SET disabled=true WHERE id='${identity.user_id}';`);
    assert.ok([401, 403].includes(get().status));
    sql(
      `UPDATE core."user" SET disabled=false WHERE id='${identity.user_id}';`,
    );
    sql(
      `UPDATE "${identity.schema}"."workspaceMember" SET "deletedAt"=now() WHERE id='${memberId}';`,
    );
    assert.ok([401, 403].includes(get().status));
    sql(
      `UPDATE "${identity.schema}"."workspaceMember" SET "deletedAt"=NULL WHERE id='${memberId}';`,
    );
    sql(
      `UPDATE core."userWorkspace" SET "deletedAt"=now() WHERE id='${identity.user_workspace_id}';`,
    );
    assert.ok([401, 403].includes(get().status));
    sql(
      `UPDATE core."userWorkspace" SET "deletedAt"=NULL WHERE id='${identity.user_workspace_id}';`,
    );
    sql(
      `UPDATE core.workspace SET "suspendedAt"=now() WHERE id='${x.workspace.id}';`,
    );
    assert.ok([401, 403].includes(get().status));
    sql(
      `UPDATE core.workspace SET "suspendedAt"=NULL WHERE id='${x.workspace.id}';`,
    );
    assert.equal(get().status, 200);
    const assertNativeObjectDenied = (response) => {
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, {
        statusCode: 404,
        error: 'NotFoundException',
        messages: ['Record unavailable'],
      });
      assert.equal(Object.hasOwn(response.body, 'data'), false);
    };
    const companyObject = JSON.parse(
      sql(
        `SELECT row_to_json(t) FROM (SELECT id,"applicationId" AS application_id FROM core."objectMetadata" WHERE "workspaceId"='${x.workspace.id}' AND "nameSingular"='company') t;`,
      ),
    );
    sql(
      `INSERT INTO core."objectPermission"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","canReadObjectRecords") VALUES('${randomUUID()}','${randomUUID()}','${companyObject.application_id}','${x.workspace.id}','${identity.role_id}','${companyObject.id}',false);`,
    );
    assertNativeObjectDenied(get('/rest/companies?depth=0&limit=100'));
    assertNativeObjectDenied(
      get('/rest/companies/' + x.info.id + '?depth=0&limit=100'),
    );
    sql(
      `DELETE FROM core."objectPermission" WHERE "roleId"='${identity.role_id}' AND "objectMetadataId"='${companyObject.id}';`,
    );
    assert.ok(
      get('/rest/companies?depth=0&limit=100').body.data.companies.some(
        (row) => row.id === x.info.id,
      ),
    );
    const personObject = JSON.parse(
      sql(
        `SELECT row_to_json(t) FROM (SELECT id,"applicationId" AS application_id FROM core."objectMetadata" WHERE "workspaceId"='${x.workspace.id}' AND "nameSingular"='person') t;`,
      ),
    );
    const jobField = sql(
      `SELECT id FROM core."fieldMetadata" WHERE "workspaceId"='${x.workspace.id}' AND "objectMetadataId"='${personObject.id}' AND name='jobTitle';`,
    );
    const role = identity.role_id;
    sql(
      `INSERT INTO core."fieldPermission"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","fieldMetadataId","canReadFieldValue","canUpdateFieldValue") VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}','${jobField}',false,false);`,
    );
    const restricted = get();
    assert.equal(restricted.status, 200);
    assert.ok(
      restricted.body.data.people.some((row) => row.id === x.contact.id),
    );
    assert.equal(
      restricted.body.data.people.find((row) => row.id === x.contact.id).name
        .lastName,
      x.company.toUpperCase(),
    );
    assert.ok(
      restricted.body.data.people.every(
        (row) => row.jobTitle === undefined || row.jobTitle === null,
      ),
    );
    sql(
      `INSERT INTO core."rowLevelPermissionPredicate"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","fieldMetadataId",operand,value) VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}','${jobField}','CONTAINS','"no-native-record-has-this-value"');`,
    );
    const rowDenied = get();
    assert.equal(rowDenied.status, 200);
    assert.equal(rowDenied.body.data.people.length, 0);
    sql(
      `DELETE FROM core."rowLevelPermissionPredicate" WHERE "roleId"='${role}';`,
    );
    sql(
      `INSERT INTO core."objectPermission"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","canReadObjectRecords") VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}',false);`,
    );
    assertNativeObjectDenied(get());
    sql(
      `DELETE FROM core."objectPermission" WHERE "roleId"='${role}' AND "objectMetadataId"='${personObject.id}';`,
    );
    const whileAuthorityBlocked = async (change, final = false) => {
      control(final ? { reset_calls: true, block_at: 5 } : { blocked: true });
      const pending = spawn(
        'docker',
        ['exec', '-i', hosted, 'node', '-e', nativeHttpScript],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      pending.stdin.end(
        JSON.stringify({
          path: '/rest/people?depth=0&limit=100',
          method: 'GET',
          headers: {
            Host: new URL(origin).host,
            Authorization: 'Bearer ' + key,
          },
        }),
      );
      let pendingResult = '',
        pendingError = '';
      pending.stdout.on('data', (chunk) => (pendingResult += chunk));
      pending.stderr.on('data', (chunk) => (pendingError += chunk));
      const pendingDeadline = setTimeout(
        () => pending.kill('SIGTERM'),
        Math.min(16000, phaseEnd - Date.now()),
      );
      const pendingFinished = new Promise((resolve) => {
        pending.on('error', (error) => resolve(error));
        pending.on('close', (code, signal) => {
          clearTimeout(pendingDeadline);
          try {
            record(pendingResult, pendingError, code, signal);
            resolve(code === 0 ? null : Error('pending native request failed'));
          } catch (error) {
            resolve(error);
          }
        });
      });
      // Poll only the bounded controlled authority; the app's real 5s authority
      // timeout and 9s request deadline stay unchanged.
      const blockedEnd = Date.now() + 4000;
      let first = null;
      try {
        let state;
        do {
          state = control(final ? {} : { blocked: true });
          if (state.pending) break;
          await pause(50);
        } while (Date.now() < blockedEnd);
        assert.equal(state.pending, 1);
        if (final) assert.equal(state.calls, 5);
        change();
      } catch (error) {
        first = error;
      } finally {
        try {
          control({ blocked: false, block_at: null });
        } catch (error) {
          if (!first) first = error;
          else
            secondary.push({
              stage: 'authority-unblock',
              message: error.message,
            });
        }
        const completionError = await pendingFinished;
        if (completionError) {
          if (!first) first = completionError;
          else
            secondary.push({
              stage: 'pending-request',
              message: completionError.message,
            });
        }
      }
      if (first) throw first;
      return JSON.parse(pendingResult.trim());
    };
    await nextRateWindow();
    sql(
      `UPDATE core."fieldPermission" SET "canReadFieldValue"=true WHERE "roleId"='${role}' AND "fieldMetadataId"='${jobField}';`,
    );
    assert.equal(
      get().body.data.people.find((row) => row.id === x.contact.id).jobTitle,
      'Synthetic Updated',
    );
    const blockedField = await whileAuthorityBlocked(() =>
      sql(
        `UPDATE core."fieldPermission" SET "canReadFieldValue"=false WHERE "roleId"='${role}' AND "fieldMetadataId"='${jobField}';`,
      ),
    );
    assert.equal(blockedField.status, 200);
    const blockedPerson = blockedField.body.data.people.find(
      (row) => row.id === x.contact.id,
    );
    assert.ok(blockedPerson);
    assert.ok(
      blockedPerson.jobTitle === undefined || blockedPerson.jobTitle === null,
    );
    const blockedRow = await whileAuthorityBlocked(() =>
      sql(
        `INSERT INTO core."rowLevelPermissionPredicate"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","fieldMetadataId",operand,value) VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}','${jobField}','CONTAINS','"no-native-record-has-this-value"');`,
      ),
    );
    assert.equal(blockedRow.status, 200);
    assert.deepEqual(blockedRow.body.data.people, []);
    sql(
      `DELETE FROM core."rowLevelPermissionPredicate" WHERE "roleId"='${role}';`,
    );
    assert.ok(get().body.data.people.some((row) => row.id === x.contact.id));
    const blockedDowngrade = await whileAuthorityBlocked(() =>
      sql(
        `INSERT INTO core."objectPermission"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","canReadObjectRecords") VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}',false);`,
      ),
    );
    assertNativeObjectDenied(blockedDowngrade);
    sql(
      `DELETE FROM core."objectPermission" WHERE "roleId"='${role}' AND "objectMetadataId"='${personObject.id}';`,
    );
    assert.equal(get().status, 200);
    const blockedRevocation = await whileAuthorityBlocked(() =>
      sql(
        `DELETE FROM core."roleTarget" WHERE "userWorkspaceId"='${identity.user_workspace_id}';`,
      ),
    );
    assert.ok([401, 403].includes(blockedRevocation.status));
    sql(
      `INSERT INTO core."roleTarget"(id,"universalIdentifier","applicationId","workspaceId","roleId","userWorkspaceId") VALUES('${randomUUID()}','${randomUUID()}','${identity.application_id}','${x.workspace.id}','${role}','${identity.user_workspace_id}');`,
    );
    assert.equal(get().status, 200);
    await nextRateWindow();
    const finalDenied = (
      response,
      message = 'Company permissions changed',
      error = 'HttpException',
      status = 401,
    ) => {
      assert.equal(response.status, status);
      assert.deepEqual(response.body, {
        statusCode: status,
        error,
        messages: [message],
      });
      assert.equal(Object.hasOwn(response.body, 'data'), false);
    };
    // Each mutation commits through the actual PG connection after native read
    // terminal/release, while only the fifth private authority call is pending.
    sql(
      `UPDATE core."fieldPermission" SET "canReadFieldValue"=true WHERE "roleId"='${role}' AND "fieldMetadataId"='${jobField}';`,
    );
    finalDenied(
      await whileAuthorityBlocked(
        () =>
          sql(
            `UPDATE core."fieldPermission" SET "canReadFieldValue"=false WHERE "roleId"='${role}' AND "fieldMetadataId"='${jobField}';`,
          ),
        true,
      ),
    );
    sql(
      `UPDATE core."fieldPermission" SET "canReadFieldValue"=true WHERE "roleId"='${role}' AND "fieldMetadataId"='${jobField}';`,
    );
    finalDenied(
      await whileAuthorityBlocked(
        () =>
          sql(
            `INSERT INTO core."rowLevelPermissionPredicate"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","fieldMetadataId",operand,value) VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}','${jobField}','CONTAINS','"no-native-record-has-this-value"');`,
          ),
        true,
      ),
    );
    sql(
      `DELETE FROM core."rowLevelPermissionPredicate" WHERE "roleId"='${role}';`,
    );
    finalDenied(
      await whileAuthorityBlocked(
        () =>
          sql(
            `INSERT INTO core."objectPermission"(id,"universalIdentifier","applicationId","workspaceId","roleId","objectMetadataId","canReadObjectRecords") VALUES('${randomUUID()}','${randomUUID()}','${personObject.application_id}','${x.workspace.id}','${role}','${personObject.id}',false);`,
          ),
        true,
      ),
    );
    sql(
      `DELETE FROM core."objectPermission" WHERE "roleId"='${role}' AND "objectMetadataId"='${personObject.id}';`,
    );
    finalDenied(
      await whileAuthorityBlocked(
        () =>
          sql(
            `DELETE FROM core."roleTarget" WHERE "userWorkspaceId"='${identity.user_workspace_id}';`,
          ),
        true,
      ),
      'Company authorization denied',
      'UnauthorizedException',
    );
    sql(
      `INSERT INTO core."roleTarget"(id,"universalIdentifier","applicationId","workspaceId","roleId","userWorkspaceId") VALUES('${randomUUID()}','${randomUUID()}','${identity.application_id}','${x.workspace.id}','${role}','${identity.user_workspace_id}');`,
    );
    finalDenied(
      await whileAuthorityBlocked(
        () => control({ status: 403, block_at: 5 }),
        true,
      ),
      'Company authorization denied',
      'UnauthorizedException',
    );
    control({ status: 200 });
    finalDenied(
      await whileAuthorityBlocked(
        () => control({ status: 503, block_at: 5 }),
        true,
      ),
      'Company authorization unavailable',
      'ServiceUnavailableException',
      503,
    );
    control({ status: 200 });
    assert.equal(get().status, 200);
    console.log(
      'PASS final post-native-read publication negatives ' +
        x.company +
        ': field/row/object/native-role/current-authority revoke/unavailable; exact error only, no data',
    );
    x.hosted = hosted;
    x.get = get;
    x.control = control;
    x.sql = sql;
    x.identity = identity;
    x.envelope = envelope;
    x.key = key;
    x.session = session;
    console.log(
      'PASS native company ' +
        x.company +
        ': genuine operator subject/user/workspace/member intersection; own read, foreign/current authority failures; legacy/native credential denial; native field/row/object ACL and role revocation while authority is blocked.',
    );
  }
  for (const [current, foreign] of [
    [companies[0], companies[1]],
    [companies[1], companies[0]],
  ]) {
    assert.ok(
      [401, 403].includes(
        current.get(undefined, { Authorization: 'Bearer ' + foreign.key })
          .status,
      ),
    );
    assert.ok(
      [401, 403].includes(
        current.get(undefined, {
          Cookie: '__Host-exe_crm_session=' + foreign.session,
        }).status,
      ),
    );
    for (const [collection, singular, foreignId] of [
      ['people', 'person', foreign.contact.id],
      ['companies', 'company', foreign.info.id],
    ]) {
      const foreignRecord = current.get(
        '/rest/' + collection + '/' + foreignId + '?depth=0&limit=100',
      );
      const absentRecord = current.get(
        '/rest/' + collection + '/' + randomUUID() + '?depth=0&limit=100',
      );
      assert.equal(foreignRecord.status, absentRecord.status);
      if (foreignRecord.status === 200) {
        assert.deepEqual(foreignRecord.body, { data: { [singular]: null } });
        assert.deepEqual(absentRecord.body, foreignRecord.body);
      } else {
        assert.ok([403, 404].includes(foreignRecord.status));
        assert.ok(!foreignRecord.body.data?.[singular]);
      }
    }
    assert.equal(
      docker([
        'inspect',
        '--format',
        '{{.State.Running}} {{.State.OOMKilled}}',
        current.hosted,
      ]),
      'true false',
    );
  }
  console.log(
    'PASS: two independent actual native CRM company read fixtures. Private synthetic company authority only; company issuance/UI SSO/commercial acceptance/capacity remain closed/unproved.',
  );
} catch (error) {
  primary = {
    stage,
    class: error.constructor.name,
    status: error.status ?? null,
    message: error.message,
  };
  for (const name of names.filter((x) => x.includes('-server-'))) {
    try {
      const captured = spawnSync('docker', ['logs', '--tail', '180', name], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: commandTimeout(10000),
      });
      record(
        captured.stdout,
        captured.stderr,
        captured.status,
        captured.signal,
      );
      const logs = captured.stdout + '\n' + captured.stderr;
      for (const line of logs.split('\n')) {
        try {
          const row = JSON.parse(line);
          if (row.level === 'error' || row.level >= 50)
            console.error(
              'Owned CRM error',
              String(
                row.err?.message ??
                  row.error?.message ??
                  row.msg ??
                  row.message ??
                  '',
              )
                .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
                .slice(0, 280),
            );
        } catch {
          if (/Error|Exception|error|failed/i.test(line))
            console.error(
              'Owned CRM diagnostic',
              line.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 300),
            );
        }
      }
    } catch {}
  }
  console.error(
    'Owned native CRM baseline failed:',
    stage,
    error.stack?.match(/native-company-read\.integration\.mjs:\d+:\d+/)?.[0] ??
      '',
  );
  process.exitCode = 1;
} finally {
  cleaning = true;
  phaseEnd = Date.now() + 60000;
  try {
    owned.removeAll();
  } catch (error) {
    secondary.push({ stage: 'container-cleanup', message: error.message });
  }
  const absent = (args, expected) => {
    try {
      docker(args);
      throw Error('Owned resource remains');
    } catch (error) {
      if (
        !Number.isInteger(error.status) ||
        error.status <= 0 ||
        !String(error.stderr).includes(expected)
      )
        throw error;
    }
  };
  for (const id of ownedIds) {
    try {
      absent(['inspect', id], 'No such object');
    } catch (error) {
      secondary.push({
        stage: 'container-absence',
        id,
        message: error.message,
      });
    }
  }
  for (const volume of anonymousVolumes) {
    try {
      absent(['volume', 'inspect', volume], ': no such volume');
    } catch (error) {
      secondary.push({
        stage: 'anonymous-volume-absence',
        volume,
        message: error.message,
      });
    }
  }
  for (const volume of volumes) {
    try {
      docker(['volume', 'rm', volume]);
      absent(['volume', 'inspect', volume], ': no such volume');
    } catch (error) {
      secondary.push({
        stage: 'volume-cleanup',
        volume,
        message: error.message,
      });
    }
  }
  for (const network of networks) {
    try {
      docker(['network', 'rm', network]);
      absent(
        ['network', 'inspect', network],
        'network ' + network + ' not found',
      );
    } catch (error) {
      secondary.push({
        stage: 'network-cleanup',
        network,
        message: error.message,
      });
    }
  }
  if (secondary.length) process.exitCode = 1;
  writeFileSync(
    join(root, 'result.json'),
    JSON.stringify(
      {
        scope:
          'actual current server-only REST/native ORM ACL; controlled central authority',
        runtimeSource,
        primary,
        secondary,
        ownedIds,
        networks,
        volumes,
        anonymousVolumes: [...anonymousVolumes],
        rawBytes,
        records,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      passed: !primary && !secondary.length,
      output: root,
      primary: primary
        ? {
            stage: primary.stage,
            class: primary.class,
            status: primary.status ?? null,
          }
        : null,
      cleanupStages: secondary.reduce((counts, error) => {
        counts[error.stage] = (counts[error.stage] ?? 0) + 1;
        return counts;
      }, {}),
    }),
  );
  // Private raw/setup/error/cleanup files intentionally survive every outcome.
}
