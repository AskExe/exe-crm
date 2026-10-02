#!/usr/bin/env node
// Exact native migrations in an owned disposable database; no existing services.
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statfsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const typescript = require('typescript');
const image = process.env.CRM_NATIVE_MIGRATION_IMAGE;
assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
const identifier = randomUUID(),
  directory = mkdtempSync(join(tmpdir(), 'crm-bootstrap-native-'));
const network = `crm-bootstrap-native-${identifier}`,
  database = `crm-bootstrap-pg-${identifier}`;
const containers = [],
  volumes = [];
const docker = (args, input) =>
  execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let stage = 'setup';
try {
  const space = statfsSync(directory);
  assert.ok(space.bavail * space.bsize >= 20 * 1024 ** 3);
  assert.equal(
    docker([
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.exe.fixture_source_sha"}}',
      image,
    ]),
    '4c926c3f60e9ebe323aa115984ffcf45502bd92b',
  );
  docker(['network', 'create', '--internal', network]);
  const password = randomBytes(32).toString('base64url');
  docker([
    'run',
    '-d',
    '--name',
    database,
    '--network',
    network,
    '--network-alias',
    'db',
    '--memory',
    '768m',
    '--cpus',
    '1',
    '--pids-limit',
    '128',
    '-e',
    'POSTGRES_USER=fixture_admin',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=crm',
    'pgvector/pgvector:pg16@sha256:00ba258a66dac104fd5171074a0084462a64a1369d8513f3d0a634e2f24d15bc',
  ]);
  containers.push(database);
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker([
        'exec',
        database,
        'pg_isready',
        '-U',
        'fixture_admin',
        '-d',
        'crm',
      ]);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  docker(
    [
      'exec',
      '-i',
      database,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'fixture_admin',
      '-d',
      'crm',
    ],
    `CREATE ROLE crm LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'; ALTER DATABASE crm OWNER TO crm; GRANT ALL ON SCHEMA public TO crm;`,
  );
  const environment = join(directory, 'environment');
  writeFileSync(
    environment,
    `PG_DATABASE_URL=postgresql://crm:${password}@db:5432/crm\nEXE_CRM_ADMIN_EMAIL=bootstrap@example.test\nIS_BILLING_ENABLED=false\nNODE_ENV=production\n`,
    { mode: 0o600 },
  );
  const source = readFileSync(
    'packages/twenty-server/src/engine/core-modules/workspace/services/workspace-bootstrap.service.ts',
    'utf8',
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  }).outputText;
  writeFileSync(join(directory, 'fixed-bootstrap.js'), compiled);
  const probe = `require('reflect-metadata');const assert=require('node:assert/strict');const {DataSource}=require('typeorm');
  (async()=>{const db=new DataSource({type:'postgres',url:process.env.PG_DATABASE_URL,schema:'core',logging:false,migrations:['/app/packages/twenty-server/dist/database/typeorm/core/migrations/common/*.js'],migrationsTableName:'_typeorm_migrations'});await db.initialize();try{
    await db.query('CREATE SCHEMA IF NOT EXISTS core');await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');await db.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await db.runMigrations();
    const {WorkspaceBootstrapService:Original}=require('./dist/engine/core-modules/workspace/services/workspace-bootstrap.service.js');const original=new Original(db);original.logger={log(){},error(){},debug(){}};await original.onModuleInit();const failed=await original.checkReadiness();assert.equal(failed.ready,false);assert.match(failed.reason,/sourcePath/);assert.equal(Number((await db.query('SELECT COUNT(*) count FROM core.workspace'))[0].count),0);
    const {WorkspaceBootstrapService:Fixed}=require('./fixture-fixed-bootstrap.js');const fixed=new Fixed(db);fixed.logger={log(){},error(){},debug(){}};await fixed.onModuleInit();assert.deepEqual(await fixed.checkReadiness(),{ready:true});
    const rows=await db.query('SELECT w.id, w."workspaceCustomApplicationId", a."workspaceId", a."sourcePath", a.version, a."canBeUninstalled", u.email FROM core.workspace w JOIN core.application a ON a.id=w."workspaceCustomApplicationId" JOIN core."userWorkspace" uw ON uw."workspaceId"=w.id JOIN core."user" u ON u.id=uw."userId"');assert.equal(rows.length,1);assert.equal(rows[0].id,rows[0].workspaceId);assert.equal(rows[0].sourcePath,'workspace-custom');assert.equal(rows[0].version,'1.0.0');assert.equal(rows[0].canBeUninstalled,false);assert.equal(rows[0].email,'bootstrap@example.test');
    process.env.EXE_CRM_ADMIN_EMAIL='replacement@example.test';const replay=new Fixed(db);replay.logger={log(){},error(){},debug(){}};await replay.onModuleInit();assert.deepEqual(await replay.checkReadiness(),{ready:true});assert.deepEqual(await db.query('SELECT id FROM core.workspace'),[{id:rows[0].id}]);assert.equal(Number((await db.query('SELECT COUNT(*) count FROM core."user"'))[0].count),1);
    console.log('PASS: actual native migrations reproduce original bootstrap failure; fixed transaction links canonical application/workspace/admin and exact replay preserves existing owner.');
  }finally{await db.destroy();}})().catch(()=>{console.error('Native bootstrap regression failed');process.exitCode=1;});`;
  writeFileSync(join(directory, 'probe.cjs'), probe);
  const name = `crm-bootstrap-probe-${identifier}`;
  containers.push(name);
  stage = 'actual-migrations-and-bootstrap';
  console.log(
    docker([
      'run',
      '--name',
      name,
      '--network',
      network,
      '--memory',
      '1g',
      '--cpus',
      '1',
      '--pids-limit',
      '128',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--env-file',
      environment,
      '-v',
      `${join(directory, 'fixed-bootstrap.js')}:/app/packages/twenty-server/fixture-fixed-bootstrap.js:ro`,
      '-v',
      `${join(directory, 'probe.cjs')}:/app/packages/twenty-server/fixture-probe.cjs:ro`,
      '--entrypoint',
      'node',
      image,
      'fixture-probe.cjs',
    ]),
  );
} catch {
  console.error('Owned native bootstrap fixture failed:', stage);
  process.exitCode = 1;
} finally {
  for (const name of containers.reverse())
    try {
      docker(['rm', '-f', name]);
    } catch {}
  for (const volume of volumes)
    try {
      docker(['volume', 'rm', volume]);
    } catch {}
  try {
    docker(['network', 'rm', network]);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
