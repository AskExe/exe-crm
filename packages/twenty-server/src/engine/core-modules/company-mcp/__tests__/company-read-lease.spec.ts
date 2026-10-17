import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { type DataSource, type QueryRunner } from 'typeorm';
import { transpileModule, ModuleKind } from 'typescript';

import {
  assertCompanyReadShape,
  withCompanyReadControl,
  withCompanyReadLease,
} from '../company-read-lease';

const setup = () => {
  const events: string[] = [];
  const controller = new AbortController();
  const runner = {
    connect: jest.fn(async () => {
      events.push('connect');
    }),
    startTransaction: jest.fn(async () => {
      events.push('begin');
    }),
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      events.push(
        sql.includes('set_config') ? 'timeout:' + values?.[0] : 'readonly',
      );
    }),
    rollbackTransaction: jest.fn(async () => {
      events.push('rollback');
    }),
    release: jest.fn(async () => {
      events.push('release');
    }),
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => runner as unknown as QueryRunner),
  };
  const control = {
    signal: controller.signal,
    monotonicDeadline: performance.now() + 8000,
    absoluteDeadline: Date.now() + 8000,
    read: { object: 'people' as const, limit: 10 },
  };
  return { events, runner, dataSource, control, controller };
};
const fatal = (): never => {
  throw new Error('fixed generic fatal');
};
beforeEach(() => {
  process.env.CRM_COMPANY_MODE = 'true';
  process.env.CRM_COMPANY_MCP_ENABLED = 'true';
});
afterEach(() => {
  jest.useRealTimers();
  delete process.env.CRM_COMPANY_MODE;
  delete process.env.CRM_COMPANY_MCP_ENABLED;
});

it('keeps ordinary reads unchanged without creating a runner', async () => {
  const { dataSource } = setup();
  expect(
    await withCompanyReadLease(
      dataSource as unknown as DataSource,
      async (lease) => {
        expect(lease).toBeUndefined();
        return 'ordinary';
      },
    ),
  ).toBe('ordinary');
  expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
});
it('uses owned master/READ ONLY, sequential terminal timeouts and cleanup before provider work', async () => {
  const { events, dataSource, control } = setup();
  const result = await withCompanyReadControl(control, () =>
    withCompanyReadLease(dataSource as unknown as DataSource, async (lease) => {
      await lease?.terminal(async () => {
        events.push('records');
        return [];
      });
      return lease?.terminal(async () => {
        events.push('fixed-count');
        return 1;
      });
    }),
  );
  events.push('provider');
  expect(result).toBe(1);
  expect(dataSource.createQueryRunner).toHaveBeenCalledWith('master');
  expect(events).toEqual([
    'connect',
    'begin',
    'readonly',
    'timeout:3000',
    'records',
    'timeout:3000',
    'fixed-count',
    'rollback',
    'release',
    'provider',
  ]);
});
it('bounds statement timeout by remaining monotonic budget', async () => {
  const { dataSource, control, runner } = setup();
  control.monotonicDeadline = performance.now() + 900;
  await withCompanyReadControl(control, () =>
    withCompanyReadLease(dataSource as unknown as DataSource, async (lease) =>
      lease?.terminal(async () => true),
    ),
  );
  const milliseconds = Number(runner.query.mock.calls[1][1]?.[0]);
  expect(milliseconds).toBeGreaterThan(0);
  expect(milliseconds).toBeLessThanOrEqual(900);
});
it('aborts before connect without allocating a connection', async () => {
  const { dataSource, control, controller } = setup();
  controller.abort();
  await expect(
    withCompanyReadControl(control, () =>
      withCompanyReadLease(
        dataSource as unknown as DataSource,
        async () => true,
      ),
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
});
it('awaits active terminal query after abort, denies new SQL, rolls back and releases', async () => {
  const { dataSource, control, controller, events, runner } = setup();
  let finish: () => void = () => {};
  const terminal = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = withCompanyReadControl(control, () =>
    withCompanyReadLease(dataSource as unknown as DataSource, async (lease) => {
      await lease?.terminal(async () => {
        events.push('read-start');
        started();
        await terminal;
        events.push('read-end');
      });
      return lease?.terminal(async () => {
        events.push('unexpected-count');
        return 1;
      });
    }),
  );
  await entered;
  controller.abort();
  await Promise.resolve();
  expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  expect(runner.release).not.toHaveBeenCalled();
  finish();
  await expect(pending).rejects.toMatchObject({ status: 503 });
  expect(events.slice(-3)).toEqual(['read-end', 'rollback', 'release']);
  expect(events).not.toContain('unexpected-count');
});
it('awaits terminal statement-timeout failure before rollback/release', async () => {
  const { dataSource, control, events } = setup();
  await expect(
    withCompanyReadControl(control, () =>
      withCompanyReadLease(dataSource as unknown as DataSource, async (lease) =>
        lease?.terminal(async () => {
          events.push('server-timeout');
          throw Object.assign(new Error('statement timeout'), {
            code: '57014',
          });
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: '57014' });
  expect(events.slice(-3)).toEqual(['server-timeout', 'rollback', 'release']);
});
it.each([
  'connect',
  'startTransaction',
  'rollbackTransaction',
  'release',
] as const)(
  'fail-stops own process on uncertain %s without unsafe pool return',
  async (step) => {
    jest.useFakeTimers();
    const { dataSource, control, runner } = setup();
    runner[step].mockRejectedValueOnce(new Error('uncertain'));
    await expect(
      withCompanyReadControl(
        control,
        () =>
          withCompanyReadLease(
            dataSource as unknown as DataSource,
            async () => true,
          ),
        fatal,
      ),
    ).rejects.toThrow('fixed generic fatal');
    if (step !== 'release') expect(runner.release).not.toHaveBeenCalled();
    jest.clearAllTimers();
  },
);
it('release completes before lease can resolve or trigger post-provider work', async () => {
  const { dataSource, control, runner } = setup();
  let complete: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  runner.release.mockImplementation(async () => gate);
  let resolved = false;
  const pending = withCompanyReadControl(control, () =>
    withCompanyReadLease(dataSource as unknown as DataSource, async () => true),
  ).then(() => {
    resolved = true;
  });
  for (let index = 0; index < 8; index++) await Promise.resolve();
  expect(resolved).toBe(false);
  complete();
  await pending;
  expect(resolved).toBe(true);
});
it('actual production watchdog terminates only its owned child process on stalled connect', () => {
  const source = readFileSync(
    resolve(__dirname, '../company-read-lease.ts'),
    'utf8',
  );
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  const script = `const Module=require('module'); const original=Module._load; Module._load=function(name,...args){ if(name==='@nestjs/common')return {ServiceUnavailableException:class extends Error{}}; if(name==='./company-mcp.config')return {companyMcpEnabled:()=>true}; if(name==='../company-auth/company-auth.config')return {companyAuthEnabled:()=>true}; return original.call(this,name,...args); }; const m=new Module('controlled');m._compile(${JSON.stringify(compiled)},'controlled'); const {performance}=require('node:perf_hooks'); m.exports.withCompanyReadControl({signal:new AbortController().signal,monotonicDeadline:performance.now()+50,absoluteDeadline:Date.now()+50,read:{object:'people',limit:1}},()=>m.exports.withCompanyReadLease({createQueryRunner:()=>({connect:()=>new Promise(()=>{})})},async()=>true));`;
  try {
    execFileSync(process.execPath, ['-e', script], {
      timeout: 8000,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    throw new Error('unexpected success');
  } catch (error) {
    const child = error as {
      status?: number;
      stderr?: Buffer;
      signal?: string;
    };
    expect(child.status).toBe(1);
    expect(child.signal).toBeNull();
    expect(String(child.stderr)).toBe('Company native read teardown failed\n');
  }
}, 10000);

const fields = { relations: {}, aggregate: {} };
it.each([
  { selectedFieldsResult: { ...fields, relations: { owner: true } } },
  { selectedFieldsResult: { ...fields, aggregate: { arbitrary: {} } } },
  {
    selectedFieldsResult: {
      ...fields,
      aggregate: {
        totalCount: {
          fromField: 'name',
          fromFieldType: 'TEXT',
          aggregateOperation: 'COUNT',
        },
      },
    },
  },
  { filter: { name: { eq: 'selector' } } },
  { orderBy: [{ name: 'AscNullsFirst' }] },
  { first: 11 },
  { offset: 1 },
  { after: 'cursor' },
])(
  'denies native selector/relation/aggregate drift before any lease',
  async (drift) => {
    const { control } = setup();
    await expect(
      withCompanyReadControl(control, async () =>
        assertCompanyReadShape('many', 'people', {
          filter: {},
          first: 10,
          selectedFieldsResult: fields,
          ...drift,
        }),
      ),
    ).rejects.toMatchObject({ status: 503 });
  },
);
it('admits only fixed list/count and exact canonical get filter; ordinary shape unchanged', async () => {
  assertCompanyReadShape('many', 'anything', {
    selectedFieldsResult: { relations: { legacy: true } },
  });
  const { control } = setup();
  await withCompanyReadControl(control, async () =>
    assertCompanyReadShape('many', 'people', {
      filter: {},
      first: 10,
      orderBy: [{}, { id: 'AscNullsFirst' }],
      selectedFieldsResult: {
        relations: {},
        aggregate: {
          totalCount: {
            fromField: 'id',
            fromFieldType: 'UUID',
            aggregateOperation: 'COUNT',
          },
        },
      },
    }),
  );
  const id = '00000000-0000-4000-8000-000000000001';
  await withCompanyReadControl(
    { ...control, read: { object: 'people', id, limit: 1 } },
    async () =>
      assertCompanyReadShape('one', 'people', {
        filter: { id: { eq: id } },
        selectedFieldsResult: fields,
      }),
  );
});

it('abort while connecting waits for connect then safely releases before any BEGIN/read', async () => {
  const { dataSource, control, controller, runner } = setup();
  let connected: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    connected = resolve;
  });
  runner.connect.mockImplementation(async () => gate);
  const pending = withCompanyReadControl(control, () =>
    withCompanyReadLease(dataSource as unknown as DataSource, async () => true),
  );
  controller.abort();
  expect(runner.release).not.toHaveBeenCalled();
  connected();
  await expect(pending).rejects.toMatchObject({ status: 503 });
  expect(runner.startTransaction).not.toHaveBeenCalled();
  expect(runner.release).toHaveBeenCalledTimes(1);
});
it('rejects test fatal injection outside test mode before any operation', async () => {
  const { control } = setup();
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const operation = jest.fn(async () => true);
  try {
    await expect(
      withCompanyReadControl(control, operation, fatal),
    ).rejects.toMatchObject({ status: 503 });
    expect(operation).not.toHaveBeenCalled();
  } finally {
    process.env.NODE_ENV = original;
  }
});
