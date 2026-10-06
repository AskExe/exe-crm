import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCompanyAuthConfiguration } from '../company-auth.config';

const original = { ...process.env };
let directory: string;
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mapping = JSON.stringify([
  {
    subject_id: uuid,
    user_id: uuid,
    user_workspace_id: uuid,
    workspace_member_id: uuid,
  },
]);

beforeEach(() => {
  process.env = { ...original };
  directory = mkdtempSync(join(tmpdir(), 'owned-company-crm-config-'));
  writeFileSync(join(directory, 'client'), 'A'.repeat(43), { mode: 0o600 });
  writeFileSync(join(directory, 'bindings'), mapping, { mode: 0o600 });
  Object.assign(process.env, {
    DISABLE_CRON_JOBS_REGISTRATION: 'true',
    CRM_COMPANY_NATIVE_SCHEMA: 'workspace_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    CRM_COMPANY_MODE: 'true',
    CRM_COMPANY_ID: uuid,
    CRM_COMPANY_WORKSPACE_ID: uuid,
    CRM_COMPANY_BINDING_ID: uuid,
    CRM_COMPANY_GENERATION_ID: uuid,
    CRM_COMPANY_AUDIENCE: 'crm-alpha',
    CRM_COMPANY_CLIENT_ID: 'crm-alpha',
    CRM_COMPANY_ORIGIN: 'https://crm.alpha.example.test',
    CRM_COMPANY_BROKER_URL: 'http://broker:8092',
    CRM_COMPANY_AUTHORITY_URL: 'http://authority:8095',
    CRM_COMPANY_CLIENT_SECRET_FILE: join(directory, 'client'),
    CRM_COMPANY_BINDINGS_FILE: join(directory, 'bindings'),
    CRM_COMPANY_BINDINGS_SHA256: createHash('sha256')
      .update(mapping)
      .digest('hex'),
    IS_MULTIWORKSPACE_ENABLED: 'false',
    IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: 'true',
  });
  for (const name of [
    'GOTRUE_URL',
    'GOTRUE_JWT_SECRET',
    'GOTRUE_SERVICE_ROLE_KEY',
    'EXE_OS_MCP_URL',
    'EXE_LICENSE_KEY',
    'ENTERPRISE_KEY',
    'EXE_CRM_ADMIN_TOKEN',
  ])
    delete process.env[name];
});
afterEach(() => {
  process.env = { ...original };
  rmSync(directory, { recursive: true, force: true });
});

it('keeps the mode default off and loads only exact immutable operator bindings when enabled', () => {
  process.env.CRM_COMPANY_MODE = 'false';
  expect(readCompanyAuthConfiguration()).toBeNull();
  delete process.env.CRM_COMPANY_MODE;
  expect(readCompanyAuthConfiguration()).toBeNull();
  process.env.CRM_COMPANY_MODE = 'true';
  const config = readCompanyAuthConfiguration();

  expect(config?.bindings.get(uuid)?.user_id).toBe(uuid);
  writeFileSync(join(directory, 'bindings'), '[]');
  expect(config?.bindings.get(uuid)?.user_id).toBe(uuid);
  expect(() => readCompanyAuthConfiguration()).toThrow();
});
it.each([
  ['CRM_COMPANY_MODE', 'TRUE'],
  ['CRM_COMPANY_ORIGIN', 'https://crm.alpha.example.test:443'],
  ['CRM_COMPANY_ORIGIN', 'https://user@crm.alpha.example.test'],
  ['CRM_COMPANY_ORIGIN', 'https://crm.alpha.example.test/'],
  ['CRM_COMPANY_AUTHORITY_URL', 'https://foreign.example.test'],
  ['CRM_COMPANY_WORKSPACE_ID', 'caller-workspace'],
  ['GOTRUE_JWT_SECRET', 'forbidden-parent-signing-key'],
  ['GOTRUE_URL', 'http://gotrue:9999'],
  ['IS_MULTIWORKSPACE_ENABLED', 'true'],
  ['IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS', 'false'],
])('rejects invalid or central/multi-workspace config %s', (name, value) => {
  process.env[name] = value;
  expect(() => readCompanyAuthConfiguration()).toThrow(
    'Invalid company auth configuration',
  );
});
it('rejects public files, changed digests and email/role mappings', () => {
  chmodSync(join(directory, 'client'), 0o644);
  expect(() => readCompanyAuthConfiguration()).toThrow();
  chmodSync(join(directory, 'client'), 0o600);
  const malicious = JSON.stringify([
    {
      subject_id: uuid,
      user_id: uuid,
      user_workspace_id: uuid,
      workspace_member_id: uuid,
      email: 'same@example.test',
      role: 'admin',
    },
  ]);

  writeFileSync(join(directory, 'bindings'), malicious);
  process.env.CRM_COMPANY_BINDINGS_SHA256 = createHash('sha256')
    .update(malicious)
    .digest('hex');
  expect(() => readCompanyAuthConfiguration()).toThrow();
});
