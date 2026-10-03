import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { type Request } from 'express';

import { type CompanyAuthConfiguration } from './company-auth.config';
import { type CompanyBrowserConfiguration } from './company-browser.config';

export const COMPANY_SESSION_COOKIE = '__Host-exe_crm_session';
export const COMPANY_FLOW_COOKIE = '__Host-exe_crm_flow';
export const COMPANY_SESSION_TOKEN = /^exs_[A-Za-z0-9_-]{43}$/;
export const COMPANY_FLOW_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
export class CompanyBrowserError extends Error {
  constructor(readonly status: number) { super('Company browser request denied'); }
}
export const browserPath = (value: string): boolean =>
  ['/company-session/start', '/company-session/callback', '/company-session/status', '/company-session/logout'].includes(value.split('?')[0]);

export const browserRequest = (request: Request, configuration: CompanyAuthConfiguration) => {
  const fail = (status = 400): never => { throw new CompanyBrowserError(status); };
  const counts = new Set<string>();
  if (request.rawHeaders.length > 64 || request.rawHeaders.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) > 16384) fail();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (counts.has(name)) fail();
    counts.add(name);
    if (['authorization', 'proxy-authorization', 'transfer-encoding', 'content-encoding', 'expect', 'upgrade'].includes(name) || /^(?:x-(?:auth|frappe|workspace|user|company|org|role)|forwarded)/.test(name)) fail(401);
  }
  if (request.headers.host !== new URL(configuration.origin).host || (request.headers.origin && request.headers.origin !== configuration.origin)) fail(403);
  if (request.headers['content-length'] && request.headers['content-length'] !== '0') fail();
  if (request.originalUrl.length > 1024 || /[%\\#\x00-\x20\x7f]/.test(request.originalUrl)) fail();
  const [path, query = '', extra] = request.originalUrl.split('?');
  if (extra !== undefined || !browserPath(path)) fail();
  if (request.method !== (path === '/company-session/logout' ? 'POST' : 'GET')) fail(405);
  if (path === '/company-session/logout' && request.headers.origin !== configuration.origin) fail(403);
  const navigation = path === '/company-session/start' || path === '/company-session/callback';
  if (!navigation && ![undefined, 'none', 'same-origin'].includes(request.headers['sec-fetch-site'] as string | undefined)) {
    // Redirect metadata covers the whole Auth/company URL list, even at own status.
    const statusNavigation = path === '/company-session/status' &&
      ['same-site', 'cross-site'].includes(request.headers['sec-fetch-site'] as string) &&
      request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document';
    if (!statusNavigation) fail(403);
  }
  if (navigation && (![undefined, 'none', 'same-origin', 'same-site', 'cross-site'].includes(request.headers['sec-fetch-site'] as string | undefined) || ![undefined, 'navigate'].includes(request.headers['sec-fetch-mode'] as string | undefined) || ![undefined, 'document'].includes(request.headers['sec-fetch-dest'] as string | undefined))) fail(403);
  const parameters = new URLSearchParams(query);
  if (path === '/company-session/callback') {
    if ([...parameters.keys()].sort().join(',') !== 'code,state' || !/^exc_[A-Za-z0-9_-]{43}$/.test(parameters.get('code') ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(parameters.get('state') ?? '')) fail();
  } else if (query) fail();
  const cookies = new Map<string, string>();
  if ((request.headers.cookie ?? '').length > 2300) fail();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    if (!part.trim()) continue;
    const at = part.trim().indexOf('=');
    const name = part.trim().slice(0, at), value = part.trim().slice(at + 1);
    if (at < 1 || cookies.has(name) || ![COMPANY_SESSION_COOKIE, COMPANY_FLOW_COOKIE].includes(name)) fail(401);
    if (name === COMPANY_SESSION_COOKIE ? !COMPANY_SESSION_TOKEN.test(value) : value.length > 2048 || !COMPANY_FLOW_TOKEN.test(value)) fail(401);
    cookies.set(name, value);
  }
  return { path, parameters, cookies };
};

const binding = (configuration: CompanyAuthConfiguration, browser: CompanyBrowserConfiguration) => ({
  version: 1, company: configuration.companyId, workspace: configuration.workspaceId,
  binding: configuration.bindingId, generation: configuration.generationId,
  audience: configuration.audience, client: configuration.clientId,
  callback: configuration.origin + '/company-session/callback', auth: browser.authOrigin,
});
const signature = (payload: string, browser: CompanyBrowserConfiguration) =>
  createHmac('sha256', browser.flowSecret).update('exe-crm-company-flow-v1\0' + payload).digest('base64url');
export const sealCompanyFlow = (configuration: CompanyAuthConfiguration, browser: CompanyBrowserConfiguration, state: string, verifier: string): string => {
  const payload = Buffer.from(JSON.stringify({ ...binding(configuration, browser), state, verifier, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return payload + '.' + signature(payload, browser);
};
export const openCompanyFlow = (raw: string | undefined, state: string, configuration: CompanyAuthConfiguration, browser: CompanyBrowserConfiguration): string => {
  if (!raw || raw.length > 2048 || !COMPANY_FLOW_TOKEN.test(raw)) throw new CompanyBrowserError(401);
  const [payload, supplied] = raw.split('.');
  const expected = signature(payload, browser);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new CompanyBrowserError(401);
  const decoded = Buffer.from(payload, 'base64url');
  if (decoded.length > 1536 || decoded.toString('base64url') !== payload) throw new CompanyBrowserError(401);
  let value: Record<string, unknown>;
  try { value = JSON.parse(decoded.toString('utf8')); } catch { throw new CompanyBrowserError(401); }
  const fixed = binding(configuration, browser);
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...Object.keys(fixed), 'state', 'verifier', 'exp'].sort().join(',') || Object.entries(fixed).some(([key, expectedValue]) => value[key] !== expectedValue) || value.state !== state || typeof value.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.verifier) || !Number.isInteger(value.exp) || Number(value.exp) <= Date.now() / 1000 || Number(value.exp) > Date.now() / 1000 + 600) throw new CompanyBrowserError(401);
  return value.verifier;
};
export const stateHash = (state: string): string => createHash('sha256').update(state).digest('hex');

export const parseBrowserProvider = (raw: Buffer): Record<string, unknown> => {
  const text = raw.toString('utf8');
  if (raw.length > 4096 || !Buffer.from(text).equals(raw)) throw new CompanyBrowserError(503);
  // Only unescaped flat scalar keys/values are part of token/revoke responses.
  const whitespace = '[ \t\r\n]*';
  const pair = '"[a-z_]+"' + whitespace + ':' + whitespace + '(?:"[A-Za-z0-9_-]*"|true|false|null|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)';
  if (!new RegExp('^' + whitespace + '\\{' + whitespace + '(?:' + pair + '(?:' + whitespace + ',' + whitespace + pair + ')*)?' + whitespace + '\\}' + whitespace + '$').test(text)) throw new CompanyBrowserError(503);
  const keys = [...text.matchAll(/"([a-z_]+)"[ \t\r\n]*:/g)].map(match => match[1]);
  if (keys.length !== new Set(keys).size) throw new CompanyBrowserError(503);
  try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new CompanyBrowserError(503); }
};
