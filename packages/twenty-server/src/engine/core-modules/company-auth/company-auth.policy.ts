import { type Request } from 'express';

import { companyAccess } from './company-access.contract';

import {
  COMPANY_UUID,
  type CompanyAuthConfiguration,
} from './company-auth.config';

export const companyReadRoute = (request: Request): boolean => {
  if (request.method !== 'GET' || request.originalUrl.length > 2048)
    return false;
  const [path, query = '', extra] = request.originalUrl.split('?');

  if (extra !== undefined) return false;
  const match = /^\/rest\/(people|companies)(?:\/([^/]+))?$/.exec(path);

  if (!match || (match[2] && !COMPANY_UUID.test(match[2]))) return false;
  const parameters = new URLSearchParams(query);

  return (
    [...parameters].every(
      ([name, value]) =>
        parameters.getAll(name).length === 1 &&
        ((name === 'depth' && value === '0') ||
          (name === 'limit' && /^(?:[1-9][0-9]?|100)$/.test(value))),
    ) &&
    parameters.get('depth') === '0' &&
    parameters.has('limit')
  );
};

export const companyCredential = (
  request: Request,
): { kind: 'key' | 'session'; value: string } => {
  const authorization = request.headers.authorization;
  const cookies = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim());
  const own = cookies.filter(
    (part) => part.split('=')[0] === '__Host-exe_crm_session',
  );

  if (own.length > 1 || (authorization && own.length))
    throw new Error('Company authorization denied');
  if (authorization && /^Bearer exk_[A-Za-z0-9_-]{43}$/.test(authorization)) {
    return { kind: 'key', value: authorization.slice(7) };
  }
  if (
    !authorization &&
    own.length === 1 &&
    /^__Host-exe_crm_session=exs_[A-Za-z0-9_-]{43}$/.test(own[0])
  ) {
    return {
      kind: 'session',
      value: own[0].slice('__Host-exe_crm_session='.length),
    };
  }
  throw new Error('Company authorization denied');
};

export const companySubject = (
  value: unknown,
  config: CompanyAuthConfiguration,
): string => {
  const authority = companyAccess(value, {
    company_id: config.companyId,
    product: 'crm',
    binding_id: config.bindingId,
    native_id: config.workspaceId,
    generation_id: config.generationId,
    audience: config.audience,
  });

  if (!authority) throw new Error('Company authorization denied');

  return authority.subject_id;
};
