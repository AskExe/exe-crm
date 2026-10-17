import { type Request } from 'express';

import { type CompanyAuthConfiguration } from '../company-auth.config';
import {
  companyCredential,
  companyReadRoute,
  companySubject,
} from '../company-auth.policy';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config = {
  companyId: uuid,
  workspaceId: uuid,
  bindingId: uuid,
  generationId: uuid,
  audience: 'crm-alpha',
} as CompanyAuthConfiguration;
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
const request = (
  url = '/rest/people?depth=0&limit=100',
  headers = {},
  method = 'GET',
) => ({ originalUrl: url, headers, method }) as Request;

describe('company read boundary', () => {
  it('allows only finite native read routes without relation expansion or caller selectors', () => {
    expect(companyReadRoute(request())).toBe(true);
    expect(
      companyReadRoute(request(`/rest/companies/${uuid}?depth=0&limit=100`)),
    ).toBe(true);
    for (const url of [
      '/graphql',
      '/metadata',
      '/healthz',
      '/rest/people',
      '/rest/people?depth=0',
      '/rest/people?limit=100',
      '/rest/people?depth=1',
      '/rest/people?depth=0&limit=101',
      '/rest/people?depth=0&depth=0',
      '/rest/people?depth=0&fields=emails',
      '/rest/people/../../metadata?depth=0',
      '/rest/people?depth=0&workspaceId=' + uuid,
    ]) {
      expect(companyReadRoute(request(url))).toBe(false);
    }
    expect(companyReadRoute(request('/rest/people?depth=0', {}, 'POST'))).toBe(
      false,
    );
  });
  it('ignores legacy parent cookies without promoting JWTs, native keys or ambiguous own credentials', () => {
    const token = 'exs_' + 'A'.repeat(43);

    expect(
      companyCredential(
        request(undefined, {
          cookie:
            'exe_sess=parent; exe_sess_refresh=refresh; __Host-exe_crm_session=' +
            token,
        }),
      ),
    ).toEqual({ kind: 'session', value: token });
    expect(
      companyCredential(
        request(undefined, { authorization: 'Bearer exk_' + 'A'.repeat(43) }),
      ).kind,
    ).toBe('key');
    for (const headers of [
      { cookie: 'exe_sess=parent' },
      { authorization: 'Bearer parent.jwt.value' },
      { authorization: 'Bearer native-key' },
      {
        cookie: `__Host-exe_crm_session=${token}; __Host-exe_crm_session=${token}`,
      },
      {
        cookie: `__Host-exe_crm_session=${token}`,
        authorization: 'Bearer exk_' + 'A'.repeat(43),
      },
    ]) {
      expect(() => companyCredential(request(undefined, headers))).toThrow();
    }
  });
  it('requires accepted current company/native/client generation and separate subscription read authority', () => {
    expect(companySubject(envelope, config)).toBe(uuid);
    for (const change of [
      { company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { native_id: 'wrong' },
      { product: 'wiki' },
      { resource_kind: 'wiki-instance' },
      { audience: 'dashboard' },
      { generation_id: 'wrong' },
      { binding_id: 'wrong' },
      { authz_epoch: '0' },
      { scopes: ['crm:write'] },
      { technical_status: 'unverified' },
      { subscription_entitled: false },
      { subject_id: 'unknown' },
      { access_token: 'parent' },
      { current_role: 'admin' },
      { current_role: ['owner'] },
    ]) {
      expect(() =>
        companySubject({ ...envelope, ...change }, config),
      ).toThrow();
    }
  });
});
