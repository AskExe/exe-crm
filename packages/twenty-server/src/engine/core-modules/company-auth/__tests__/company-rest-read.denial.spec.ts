import { HttpException } from '@nestjs/common';
import { type Request, type Response } from 'express';

import { type RestApiCoreService } from 'src/engine/api/rest/core/services/rest-api-core.service';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { CompanyAuthService } from '../company-auth.service';
import { CompanyRestReadService } from '../company-rest-read.service';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalMode = process.env.CRM_COMPANY_MODE;
beforeEach(() => {
  process.env.CRM_COMPANY_MODE = 'true';
});
afterEach(() => {
  if (originalMode === undefined) delete process.env.CRM_COMPANY_MODE;
  else process.env.CRM_COMPANY_MODE = originalMode;
});
const nativeFailure = async (error: unknown) => {
  const auth = {
    configuration: { origin: 'https://crm.fixture.test', workspaceId: uuid },
    currentRead: jest.fn().mockResolvedValue({
      fingerprint: 'same',
      context: {
        workspace: { id: uuid },
        user: { id: uuid },
        userWorkspaceId: uuid,
        workspaceMemberId: uuid,
        workspaceMember: { id: uuid },
      },
    }),
  };
  const reads = { get: jest.fn().mockRejectedValue(error) };
  const response = {
    send: jest.fn(),
    status: jest.fn(),
    type: jest.fn(),
    setHeader: jest.fn(),
  };
  const service = new CompanyRestReadService(
    auth as unknown as CompanyAuthService,
    reads as unknown as RestApiCoreService,
  );
  const request = {
    rawHeaders: ['Host', 'crm.fixture.test'],
    headers: {
      host: 'crm.fixture.test',
      cookie: '__Host-exe_crm_session=exs_' + 'A'.repeat(43),
    },
    method: 'GET',
    path: '/rest/people',
    originalUrl: '/rest/people?depth=0&limit=100',
  } as unknown as Request;
  let caught: unknown;
  try {
    await service.handle(
      request,
      response as unknown as Response,
      new AbortController().signal,
    );
  } catch (failure) {
    caught = failure;
  }
  expect(reads.get).toHaveBeenCalledTimes(1);
  expect(auth.currentRead).toHaveBeenCalledTimes(1);
  expect(response.send).not.toHaveBeenCalled();
  expect(response.status).not.toHaveBeenCalled();
  expect(response.setHeader).not.toHaveBeenCalled();
  expect(caught).toBeInstanceOf(HttpException);
  return caught as HttpException;
};
it('conceals the genuine typed native permission denial using fixed404 without publishing data', async () => {
  const failure = await nativeFailure(
    new PermissionsException(
      'private native detail',
      PermissionsExceptionCode.PERMISSION_DENIED,
    ),
  );
  expect(failure.getStatus()).toBe(404);
  expect(failure.message).toBe('Record unavailable');
  expect(failure.constructor.name).toBe('NotFoundException');
  expect(failure.getResponse()).not.toHaveProperty('data');
});
it.each([
  new PermissionsException(
    'private native detail',
    PermissionsExceptionCode.INVALID_ARG,
  ),
  Object.assign(new Error('private native detail'), {
    code: PermissionsExceptionCode.PERMISSION_DENIED,
  }),
  new Error('private generic failure'),
])(
  'keeps unrelated typed/code-lookalike/generic native failures unavailable',
  async (error) => {
    const failure = await nativeFailure(error);
    expect(failure.getStatus()).toBe(503);
    expect(failure.message).toBe('Company read unavailable');
    expect(failure.getResponse()).not.toHaveProperty('data');
  },
);
it.each([403, 404])(
  'preserves existing native HTTP%s concealment',
  async (status) => {
    const failure = await nativeFailure(
      new HttpException('private native detail', status),
    );
    expect(failure.getStatus()).toBe(404);
    expect(failure.message).toBe('Record unavailable');
    expect(failure.getResponse()).not.toHaveProperty('data');
  },
);
it.each([400, 401, 503])(
  'preserves existing native HTTP%s unavailable mapping',
  async (status) => {
    const failure = await nativeFailure(
      new HttpException('private native detail', status),
    );
    expect(failure.getStatus()).toBe(status);
    expect(failure.message).toBe('Company read unavailable');
    expect(failure.getResponse()).not.toHaveProperty('data');
  },
);
