import { type Request, type Response } from 'express';
import { companyAuthIngress } from 'src/engine/core-modules/company-auth/company-auth.ingress';
import { type CompanyAuthConfiguration } from 'src/engine/core-modules/company-auth/company-auth.config';

const config = {
  origin: 'https://crm.alpha.example.test',
} as CompanyAuthConfiguration;
const incoming = () => ({
  method: 'POST',
  originalUrl: '/company-mcp',
  rawHeaders: [
    'Host',
    'crm.alpha.example.test',
    'Content-Type',
    'application/json',
  ],
  headers: {
    host: 'crm.alpha.example.test',
    'content-type': 'application/json',
    'content-length': '100',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer exk_' + 'A'.repeat(43),
    'mcp-protocol-version': '2025-11-25',
  },
});
const run = (request: ReturnType<typeof incoming>) => {
  const next = jest.fn(),
    response = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  companyAuthIngress(config)(
    request as unknown as Request,
    response as unknown as Response,
    next,
  );
  return { next, response };
};
beforeEach(() => {
  process.env.CRM_COMPANY_MODE = 'true';
  process.env.CRM_COMPANY_MCP_ENABLED = 'true';
});
afterEach(() => {
  delete process.env.CRM_COMPANY_MODE;
  delete process.env.CRM_COMPANY_MCP_ENABLED;
});
it('admits only exact fixed transport and preserves protocol header', () => {
  const request = incoming();
  expect(run(request).next).toHaveBeenCalledTimes(1);
  expect(request.headers['mcp-protocol-version']).toBe('2025-11-25');
});
it.each([
  'foreign.test',
  'crm.beta.example.test',
  'crm.alpha.example.test:443',
])('denies foreign/ambiguous Host%s', (host) => {
  const request = incoming();
  request.headers.host = host;
  expect(run(request).next).not.toHaveBeenCalled();
});
it.each([
  'origin',
  'cookie',
  'transfer-encoding',
  'content-encoding',
  'expect',
])('denies hostile %s', (header) => {
  const request = incoming();
  Object.assign(request.headers, { [header]: 'foreign' });
  expect(run(request).next).not.toHaveBeenCalled();
});
it.each(['0', '8193', '100000', '1.2', '001'])(
  'bounds body before parser%s',
  (length) => {
    const request = incoming();
    request.headers['content-length'] = length;
    expect(run(request).next).not.toHaveBeenCalled();
  },
);
it('denies duplicate headers and route/query ambiguity', () => {
  const request = incoming();
  request.rawHeaders.push(
    'Authorization',
    'Bearer first',
    'Authorization',
    'Bearer second',
  );
  expect(run(request).next).not.toHaveBeenCalled();
  request.rawHeaders = [];
  request.originalUrl += '?api_key=secret';
  expect(run(request).next).not.toHaveBeenCalled();
});
it('keeps ordinary company/native POST closed when MCP flag absent', () => {
  delete process.env.CRM_COMPANY_MCP_ENABLED;
  expect(run(incoming()).next).not.toHaveBeenCalled();
});

it('returns the transport-required 403 for a foreign Origin', () => {
  const request = incoming();
  Object.assign(request.headers, { origin: 'https://foreign.test' });
  expect(run(request).response.status).toHaveBeenCalledWith(403);
});
