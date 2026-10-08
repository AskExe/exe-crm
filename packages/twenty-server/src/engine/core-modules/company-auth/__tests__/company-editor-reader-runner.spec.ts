import { UnauthorizedException } from '@nestjs/common';

import { CommonFindOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-find-one-query-runner.service';
import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import { CommonUpdateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-one-query-runner.service';
import { type CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';

let mockEditorEnabled = true;
jest.mock('../company-editor.config', () => ({
  companyEditorEnabled: () => mockEditorEnabled,
}));

const context = {
  authContext: {},
  flatObjectMetadata: {
    nameSingular: 'person',
    namePlural: 'people',
    isSystem: false,
  },
} as unknown as CommonBaseQueryRunnerContext;
const afterBoundary = new Error('After the admitted editor boundary');
const args = { selectedFields: { id: true } };
beforeEach(() => {
  mockEditorEnabled = true;
});

it('an actual FindOne reader reaches the native path without requiring a write grant', async () => {
  const runner = new CommonFindOneQueryRunnerService();
  const boundary = jest.fn(async (readOnly: boolean, system: boolean) => {
    if (!readOnly || system) throw new UnauthorizedException();
  });
  Reflect.set(runner, 'companyAuthService', { assertEditorRecord: boundary });
  const nativePath = jest.fn(async () => {
    throw afterBoundary;
  });
  Reflect.set(runner, 'throttleQueryExecution', nativePath);
  await expect(
    runner.execute(
      args as unknown as Parameters<typeof runner.execute>[0],
      context,
    ),
  ).rejects.toBe(afterBoundary);
  expect(boundary).toHaveBeenCalledWith(true, false);
  expect(nativePath).toHaveBeenCalledTimes(1);
});

it('an actual UpdateOne still refuses the reader before the native path', async () => {
  const runner = new CommonUpdateOneQueryRunnerService(
    new CommonUpdateManyQueryRunnerService(),
  );
  const denial = new UnauthorizedException();
  const boundary = jest.fn(async (readOnly: boolean) => {
    if (!readOnly) throw denial;
  });
  Reflect.set(runner, 'companyAuthService', { assertEditorRecord: boundary });
  const nativePath = jest.fn();
  Reflect.set(runner, 'throttleQueryExecution', nativePath);
  await expect(
    runner.execute(
      args as unknown as Parameters<typeof runner.execute>[0],
      context,
    ),
  ).rejects.toBe(denial);
  expect(boundary).toHaveBeenCalledWith(false, false);
  expect(nativePath).not.toHaveBeenCalled();
});

it('the actual post-metadata boundary also classifies FindOne as read-only', async () => {
  const runner = new CommonFindOneQueryRunnerService();
  const metadata = jest.fn(async () => context);
  Reflect.set(
    runner,
    'prepareExtendedQueryRunnerContextWithGlobalDatasource',
    metadata,
  );
  const boundary = jest.fn(async (readOnly: boolean) => {
    expect(metadata).toHaveBeenCalledTimes(1);
    if (!readOnly) throw new UnauthorizedException();
  });
  Reflect.set(runner, 'companyAuthService', { assertEditorRecord: boundary });
  Reflect.set(
    runner,
    'run',
    jest.fn(async () => {
      throw afterBoundary;
    }),
  );
  const execute = Reflect.get(runner, 'executeQueryAndEnrichResults');
  await expect(Reflect.apply(execute, runner, [{}, context, {}])).rejects.toBe(
    afterBoundary,
  );
  expect(boundary).toHaveBeenCalledWith(true, false);
});

it('ordinary native execution never enters the editor grant boundary', async () => {
  mockEditorEnabled = false;
  const runner = new CommonFindOneQueryRunnerService();
  const boundary = jest.fn();
  Reflect.set(runner, 'companyAuthService', { assertEditorRecord: boundary });
  Reflect.set(
    runner,
    'throttleQueryExecution',
    jest.fn(async () => {
      throw afterBoundary;
    }),
  );
  await expect(
    runner.execute(
      args as unknown as Parameters<typeof runner.execute>[0],
      context,
    ),
  ).rejects.toBe(afterBoundary);
  expect(boundary).not.toHaveBeenCalled();
  expect(Reflect.get(runner, 'isReadOnly')).toBe(false);
});
