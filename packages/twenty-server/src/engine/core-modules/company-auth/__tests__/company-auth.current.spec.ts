import { type Request } from 'express';
import { type DataSource } from 'typeorm';

import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

import { CompanyAuthService } from '../company-auth.service';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const readConfig = jest.fn();

jest.mock('../company-auth.config', () => ({
  ...jest.requireActual('../company-auth.config'),
  readCompanyAuthConfiguration: () => readConfig(),
}));
const originalFetch = global.fetch;
const envelope = {
  version: 1,
  subject_id: uuid,
  company_id: uuid,
  product: 'crm',
  resource_kind: 'crm-workspace',
  binding_id: uuid,
  native_id: uuid,
  generation_id: uuid,
  authz_epoch: '1',
  audience: 'crm-alpha',
  scopes: ['crm:read'],
  current_role: 'owner',
  technical_status: 'accepted',
  subscription_entitled: true,
};
const repository = { findOne: jest.fn() };
const dataSource = {
  getRepository: jest.fn(() => repository),
  createQueryBuilder: jest.fn(),
};
const cache = { invalidateAndRecompute: jest.fn(), getOrRecompute: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  readConfig.mockReturnValue({
    companyId: uuid,
    workspaceId: uuid,
    bindingId: uuid,
    generationId: uuid,
    audience: 'crm-alpha',
    clientId: 'crm-alpha',
    clientSecret: 'private-fixture-secret',
    brokerUrl: 'http://broker:8092',
    authorityUrl: 'http://authority:8095',
    bindings: new Map([
      [
        uuid,
        {
          subject_id: uuid,
          user_id: uuid,
          user_workspace_id: uuid,
          workspace_member_id: uuid,
        },
      ],
    ]),
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});
const service = () =>
  new CompanyAuthService(
    dataSource as unknown as DataSource,
    cache as unknown as WorkspaceCacheService,
  );
const request = {
  headers: { authorization: 'Bearer exk_' + 'A'.repeat(43) },
} as Request;

it('looks up current native membership after blocked central verification and denies a removed native user', async () => {
  let release: (value: Response) => void = () => {};

  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const current = service().authenticate(request);

  expect(repository.findOne).not.toHaveBeenCalled();
  repository.findOne.mockResolvedValue(null);
  release(new Response(JSON.stringify(envelope), { status: 200 }));
  await expect(current).rejects.toMatchObject({ status: 401 });
  expect(repository.findOne).toHaveBeenCalled();
  expect(cache.invalidateAndRecompute).not.toHaveBeenCalled();
});
it.each([400, 401, 403, 404, 503])(
  'does not touch native identity or cached ACL after authority status %s',
  async (status) => {
    global.fetch = jest.fn(
      async () => new Response('{"error":"unavailable"}', { status }),
    );
    await expect(service().authenticate(request)).rejects.toMatchObject({
      status:
        status === 400 ? 400 : status === 401 || status === 403 ? 401 : 503,
    });
    expect(repository.findOne).not.toHaveBeenCalled();
  },
);
it('uses a fixed native client and no caller actor/workspace selectors in private introspection', async () => {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          ...envelope,
          company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
        { status: 200 },
      ),
  );
  await expect(service().authenticate(request)).rejects.toMatchObject({
    status: 401,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    'http://authority:8095/internal/company-authority/key-introspect',
    expect.objectContaining({
      redirect: 'error',
      body: JSON.stringify({ api_key: 'exk_' + 'A'.repeat(43) }),
      headers: expect.objectContaining({
        Authorization:
          'Basic ' +
          Buffer.from('crm-alpha:private-fixture-secret').toString('base64'),
      }),
    }),
  );
  expect(repository.findOne).not.toHaveBeenCalled();
});
