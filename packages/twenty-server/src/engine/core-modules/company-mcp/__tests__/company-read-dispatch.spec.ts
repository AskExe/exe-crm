jest.mock(
  'src/engine/api/common/common-query-runners/common-base-query-runner.service',
  () => ({ CommonBaseQueryRunnerService: class {} }),
);
jest.mock(
  'src/engine/api/graphql/graphql-query-runner/utils/build-columns-to-select',
  () => ({ buildColumnsToSelect: () => ({ id: true }) }),
);
jest.mock(
  'src/engine/api/graphql/graphql-query-runner/helpers/process-aggregate.helper',
  () => ({
    ProcessAggregateHelper: {
      addSelectedAggregatedFieldsQueriesToQueryBuilder: jest.fn(),
    },
  }),
);
jest.mock('src/engine/api/common/utils/get-page-info.util', () => ({
  getPageInfo: () => ({ hasNextPage: false }),
}));

import { performance } from 'node:perf_hooks';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  type CommonExtendedInput,
  type FindOneQueryArgs,
  type FindManyQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { CommonFindOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-one-query-runner.service';
import { CommonFindManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-many-query-runner.service';
import { withCompanyReadControl } from '../company-read-lease';

const setup = () => {
  const events: string[] = [];
  const runner = {
    connect: jest.fn(async () => {
      events.push('connect');
    }),
    startTransaction: jest.fn(async () => {
      events.push('begin');
    }),
    query: jest.fn(async () => {
      events.push('setting');
    }),
    rollbackTransaction: jest.fn(async () => {
      events.push('rollback');
    }),
    release: jest.fn(async () => {
      events.push('release');
    }),
  };
  const aggregate = {
    getRawOne: jest.fn(async () => {
      events.push('count');
      return { totalCount: 1 };
    }),
    select: jest.fn(),
    addSelect: jest.fn(),
  };
  const builder = {
    setFindOptions: jest.fn(),
    take: jest.fn(),
    skip: jest.fn(),
    getOne: jest.fn(async () => {
      events.push('record');
      return { id: 'permitted' };
    }),
    getMany: jest.fn(async () => {
      events.push('records');
      return [{ id: 'permitted' }];
    }),
    clone: jest.fn(() => aggregate),
  };
  for (const method of [builder.setFindOptions, builder.take, builder.skip])
    method.mockReturnValue(builder);
  const source = { createQueryRunner: jest.fn(() => runner) };
  const repository = { createQueryBuilder: jest.fn(() => builder) };
  const context = {
    repository,
    workspaceDataSource: source,
    flatObjectMetadata: { nameSingular: 'person', namePlural: 'people' },
    flatObjectMetadataMaps: {},
    flatFieldMetadataMaps: {},
    authContext: {},
    rolePermissionConfig: {},
    commonQueryParser: {
      applyFilterToBuilder: jest.fn(),
      applyDeletedAtToBuilder: jest.fn(),
      applyOrderToBuilder: jest.fn(),
      addRelationOrderColumnsToBuilder: jest.fn(),
    },
  } as unknown as CommonExtendedQueryRunnerContext;
  const control = {
    signal: new AbortController().signal,
    monotonicDeadline: performance.now() + 8000,
    absoluteDeadline: Date.now() + 8000,
    read: { object: 'people' as const, limit: 1 },
  };
  const nested = { processNestedRelations: jest.fn(async () => {}) };
  const one = Object.assign(new CommonFindOneQueryRunnerService(), {
    processNestedRelationsHelper: nested,
  });
  const many = Object.assign(new CommonFindManyQueryRunnerService(), {
    processNestedRelationsHelper: nested,
  });
  return {
    events,
    source,
    repository,
    runner,
    context,
    control,
    one,
    many,
    nested,
  };
};
const id = '00000000-0000-4000-8000-000000000001';
const oneArgs = {
  selectedFields: { id: true },
  filter: { id: { eq: id } },
  selectedFieldsResult: { select: { id: true }, relations: {}, aggregate: {} },
} as CommonExtendedInput<FindOneQueryArgs>;
const manyArgs = {
  selectedFields: { id: true },
  filter: {},
  first: 1,
  selectedFieldsResult: {
    select: { id: true },
    relations: {},
    aggregate: {
      totalCount: {
        fromField: 'id',
        fromFieldType: 'UUID',
        aggregateOperation: 'COUNT',
      },
    },
  },
} as unknown as CommonExtendedInput<FindManyQueryArgs>;
beforeEach(() => {
  process.env.CRM_COMPANY_MODE = 'true';
  process.env.CRM_COMPANY_MCP_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.CRM_COMPANY_MODE;
  delete process.env.CRM_COMPANY_MCP_ENABLED;
});
it.each(['one', 'many'] as const)(
  'preserves ordinary CommonFind%s dispatch without owned runner',
  async (kind) => {
    const s = setup();
    if (kind === 'one') await s.one.run(oneArgs, s.context);
    else await s.many.run(manyArgs, s.context);
    expect(s.source.createQueryRunner).not.toHaveBeenCalled();
    expect(s.repository.createQueryBuilder).toHaveBeenCalledWith(
      'person',
      undefined,
    );
    expect(s.nested.processNestedRelations).toHaveBeenCalledTimes(1);
  },
);
it('threads owned runner into exact FindOne ACL builder and cleans before returning', async () => {
  const s = setup();
  expect(
    await withCompanyReadControl(
      { ...s.control, read: { object: 'people', id, limit: 1 } },
      () => s.one.run(oneArgs, s.context),
    ),
  ).toEqual({ id: 'permitted' });
  expect(s.repository.createQueryBuilder).toHaveBeenCalledWith(
    'person',
    s.runner,
  );
  expect(s.events).toEqual([
    'connect',
    'begin',
    'setting',
    'setting',
    'record',
    'rollback',
    'release',
  ]);
  expect(s.nested.processNestedRelations).not.toHaveBeenCalled();
});
it('threads same owned runner through sequential records and fixed-count clone', async () => {
  const s = setup();
  const value = await withCompanyReadControl(s.control, () =>
    s.many.run(manyArgs, s.context),
  );
  expect(value.records).toEqual([{ id: 'permitted' }]);
  expect(s.repository.createQueryBuilder).toHaveBeenCalledWith(
    'person',
    s.runner,
  );
  expect(s.events).toEqual([
    'connect',
    'begin',
    'setting',
    'setting',
    'records',
    'setting',
    'count',
    'rollback',
    'release',
  ]);
  expect(s.nested.processNestedRelations).not.toHaveBeenCalled();
});
it('rejects native relation drift before allocating runner or constructing builder', async () => {
  const s = setup();
  await expect(
    withCompanyReadControl(s.control, () =>
      s.many.run(
        {
          ...manyArgs,
          selectedFieldsResult: {
            ...manyArgs.selectedFieldsResult,
            relations: { owner: true },
          },
        },
        s.context,
      ),
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(s.source.createQueryRunner).not.toHaveBeenCalled();
  expect(s.repository.createQueryBuilder).not.toHaveBeenCalled();
});
