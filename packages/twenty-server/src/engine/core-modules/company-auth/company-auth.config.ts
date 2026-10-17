import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';

export const COMPANY_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CompanyNativeBinding = {
  subject_id: string;
  user_id: string;
  user_workspace_id: string;
  workspace_member_id: string;
};

export type CompanyAuthConfiguration = {
  companyId: string;
  workspaceId: string;
  nativeSchema: string;
  bindingId: string;
  generationId: string;
  audience: string;
  clientId: string;
  origin: string;
  brokerUrl: string;
  authorityUrl: string;
  clientSecret: string;
  bindings: ReadonlyMap<string, CompanyNativeBinding>;
};

export const companyAuthEnabled = (): boolean => {
  const value = process.env.CRM_COMPANY_MODE ?? 'false';

  if (value !== 'true' && value !== 'false') {
    throw new Error('Invalid company auth configuration');
  }

  return value === 'true';
};

const secretFile = (path: string, maximumBytes: number): Buffer => {
  if (!path.startsWith('/'))
    throw new Error('Invalid company auth configuration');

  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const stat = fstatSync(descriptor);

    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > maximumBytes
    ) {
      throw new Error('Invalid company auth configuration');
    }

    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

export const readCompanyAuthConfiguration =
  (): CompanyAuthConfiguration | null => {
    if (!companyAuthEnabled()) return null;
    const required = (name: string): string => {
      const value = process.env[name] ?? '';

      if (!value || value.trim() !== value)
        throw new Error('Invalid company auth configuration');

      return value;
    };
    const uuid = (name: string): string => {
      const value = required(name);

      if (!COMPANY_UUID.test(value))
        throw new Error('Invalid company auth configuration');

      return value;
    };
    const privateOrigin = (name: string): string => {
      const value = required(name);

      if (
        !/^http:\/\/[a-z][a-z0-9-]{0,62}:[1-9][0-9]{0,4}$/.test(value) ||
        Number(new URL(value).port) > 65535
      )
        throw new Error('Invalid company auth configuration');

      return value;
    };
    const nativeSchema = required('CRM_COMPANY_NATIVE_SCHEMA');

    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(nativeSchema))
      throw new Error('Invalid company auth configuration');

    const origin = required('CRM_COMPANY_ORIGIN');

    if (
      !/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(origin) ||
      new URL(origin).origin !== origin ||
      new URL(origin).hostname.length > 253 ||
      new URL(origin).hostname.split('.').some((label) => label.length > 63)
    ) {
      throw new Error('Invalid company auth configuration');
    }
    for (const name of [
      'GOTRUE_URL',
      'GOTRUE_JWT_SECRET',
      'GOTRUE_SERVICE_ROLE_KEY',
      'GOTRUE_ADMIN_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'EXE_OS_MCP_URL',
      'EXE_LICENSE_KEY',
      'ENTERPRISE_KEY',
      'EXE_CRM_ADMIN_TOKEN',
    ]) {
      if (process.env[name])
        throw new Error('Invalid company auth configuration');
    }
    if (
      process.env.IS_MULTIWORKSPACE_ENABLED !== 'false' ||
      process.env.IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS !== 'true' ||
      process.env.DISABLE_CRON_JOBS_REGISTRATION !== 'true'
    ) {
      throw new Error('Invalid company auth configuration');
    }
    const clientId = required('CRM_COMPANY_CLIENT_ID');
    const audience = required('CRM_COMPANY_AUDIENCE');

    if (
      ![clientId, audience].every((value) =>
        /^[a-z][a-z0-9_-]{1,127}$/.test(value),
      )
    ) {
      throw new Error('Invalid company auth configuration');
    }
    const clientSecret = secretFile(
      required('CRM_COMPANY_CLIENT_SECRET_FILE'),
      256,
    )
      .toString('utf8')
      .trim();

    if (!/^[A-Za-z0-9_-]{32,128}$/.test(clientSecret))
      throw new Error('Invalid company auth configuration');
    const content = secretFile(required('CRM_COMPANY_BINDINGS_FILE'), 65536);

    if (
      createHash('sha256').update(content).digest('hex') !==
      required('CRM_COMPANY_BINDINGS_SHA256')
    ) {
      throw new Error('Invalid company auth configuration');
    }
    const parsed: unknown = JSON.parse(content.toString('utf8'));

    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
      throw new Error('Invalid company auth configuration');
    }
    const bindings = new Map<string, CompanyNativeBinding>();
    const nativeUsers = new Set<string>();

    for (const entry of parsed) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Object.keys(entry).sort().join(',') !==
          'subject_id,user_id,user_workspace_id,workspace_member_id' ||
        !Object.values(entry).every(
          (value) => typeof value === 'string' && COMPANY_UUID.test(value),
        ) ||
        bindings.has(entry.subject_id) ||
        nativeUsers.has(entry.user_id)
      ) {
        throw new Error('Invalid company auth configuration');
      }
      bindings.set(entry.subject_id, Object.freeze({ ...entry }));
      nativeUsers.add(entry.user_id);
    }

    return Object.freeze({
      companyId: uuid('CRM_COMPANY_ID'),
      workspaceId: uuid('CRM_COMPANY_WORKSPACE_ID'),
      nativeSchema,
      bindingId: uuid('CRM_COMPANY_BINDING_ID'),
      generationId: uuid('CRM_COMPANY_GENERATION_ID'),
      audience,
      clientId,
      origin,
      clientSecret,
      bindings,
      brokerUrl: privateOrigin('CRM_COMPANY_BROKER_URL'),
      authorityUrl: privateOrigin('CRM_COMPANY_AUTHORITY_URL'),
    });
  };
