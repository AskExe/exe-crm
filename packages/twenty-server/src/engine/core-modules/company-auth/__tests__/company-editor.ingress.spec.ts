import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';

import { type CompanyAuthConfiguration } from '../company-auth.config';
import { companyEditorIngress } from '../company-editor.ingress';

// Actual Express dispatch verifies that denied APIs never reach the native
// middleware chain and that SPA fallback serves only the compiled frontend.
describe('company editor transport boundary', () => {
  beforeAll(() => jest.useRealTimers());
  afterAll(() => jest.useFakeTimers());
  const configuration = {
    origin: 'https://crm.example.test',
  } as CompanyAuthConfiguration;
  const cookie = '__Host-exe_crm_session=exs_' + 'a'.repeat(43);
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'crm-editor-'));
    writeFileSync(join(root, 'index.html'), 'native compiled UI');
  });
  afterEach(() => rmSync(root, { recursive: true }));
  const app = () => {
    const server = express();
    server.use(companyEditorIngress(configuration, root));
    server.use((_request, response) => response.json({ native: true }));
    return server;
  };
  it('admits an opaque same-origin JSON request to native GraphQL', async () => {
    const response = await request(app())
      .post('/graphql')
      .set('Host', 'crm.example.test')
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ query: '{ people { id } }' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ native: true });
  });
  it.each([
    '/auth/login',
    '/api/auth/admin-token',
    '/graphql/subscription',
    '/metadata/export',
    '/files/upload',
    '/healthz',
    '/rest/workspaces',
    '/company-mcp',
  ])('denies %s before native dispatch or SPA fallback', async (path) => {
    const response = await request(app())
      .get(path)
      .set('Host', 'crm.example.test');
    expect(response.status).toBe(403);
    expect(response.text).not.toContain('native compiled UI');
  });
  it.each([
    { authorization: 'Bearer admin-token' },
    {
      cookie: '__Host-exe_crm_session=exs_' + 'b'.repeat(43),
      origin: 'https://foreign.test',
    },
    { 'x-workspace-id': 'foreign' },
    { 'sec-fetch-site': 'cross-site' },
  ])('denies authority and upload side doors %p', async (headers) => {
    const response = await request(app())
      .post('/graphql')
      .set('Host', 'crm.example.test')
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ query: '{ people { id } }' })
      .set(headers);
    expect(response.status).toBe(403);
    expect(response.body.native).toBeUndefined();
  });
  it('denies multipart before the upload parser', async () => {
    const response = await request(app())
      .post('/graphql')
      .set('Host', 'crm.example.test')
      .set('Cookie', cookie)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Content-Type', 'multipart/form-data')
      .send('bounded upload');
    expect(response.status).toBe(403);
  });
  it('serves native UI routes from the compiled frontend without dispatching a controller', async () => {
    const response = await request(app())
      .get('/objects/people')
      .set('Host', 'crm.example.test');
    expect(response.status).toBe(200);
    expect(response.text).toBe('native compiled UI');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('refuses missing assets instead of returning HTML', async () => {
    const response = await request(app())
      .get('/assets/missing.js')
      .set('Host', 'crm.example.test');
    expect(response.status).toBe(403);
  });
});
