import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const entrypoint = resolve(
  __dirname,
  '../../../../../../twenty-docker/twenty/entrypoint.sh',
);
const boot = (mode: string | undefined, license = '') =>
  spawnSync('sh', [entrypoint, 'true'], {
    env: {
      PATH: process.env.PATH,
      DISABLE_DB_MIGRATIONS: 'true',
      DISABLE_CRON_JOBS_REGISTRATION: 'true',
      EXE_LICENSE_KEY: license,
      ...(mode === undefined ? {} : { CRM_COMPANY_MODE: mode }),
    },
    encoding: 'utf8',
  });

describe('native company entrypoint', () => {
  it('preserves the legacy license requirement when disabled or absent', () => {
    expect(boot(undefined).status).toBe(1);
    expect(boot('false').status).toBe(1);
    expect(boot('false', 'owned-fixture-license').status).toBe(0);
  });
  it('defers fixed company authority to Nest without legacy license activation', () => {
    expect(boot('true').status).toBe(0);
    expect(boot('TRUE', 'owned-fixture-license').status).toBe(1);
    expect(boot('1', 'owned-fixture-license').status).toBe(1);
  });
});
