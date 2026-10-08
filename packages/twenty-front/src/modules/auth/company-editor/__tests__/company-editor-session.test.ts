import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';

jest.mock('~/config', () => ({ REACT_APP_COMPANY_EDITOR_ENABLED: true }));

import type * as CompanyEditorSession from '@/auth/company-editor/company-editor-session';
import type * as Undici from 'undici';
type Session = typeof CompanyEditorSession;
const contextA = 'a'.repeat(64),
  contextB = 'b'.repeat(64);
const csrf = 'a'.repeat(43) + '.1999999999.' + 'b'.repeat(43);
const proof = (context = contextA, extra = {}) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ context, csrf, ...extra })),
        );
        controller.close();
      },
    }),
  }) as unknown as Response;
const reply = () =>
  ({
    status: 200,
    text: async () => '{"data":{"person":{"id":"A"}}}',
  }) as Response;

describe('opaque editor request confinement', () => {
  let session: Session;
  let fetchMock: jest.Mock;
  beforeAll(() => {
    Object.defineProperty(globalThis, 'TextDecoder', {
      value: TextDecoder,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'TextEncoder', {
      value: TextEncoder,
      configurable: true,
    });
    const { Headers } = require('undici') as typeof Undici;
    Object.defineProperty(globalThis, 'Headers', {
      value: Headers,
      configurable: true,
    });
    Object.defineProperty(AbortSignal, 'timeout', {
      value: () => new AbortController().signal,
      configurable: true,
    });
  });
  beforeEach(async () => {
    jest.resetModules();
    fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
    });
    session = await import('../company-editor-session');
  });
  it('deduplicates initialization without inventing a bearer token', async () => {
    fetchMock.mockResolvedValueOnce(proof());
    await Promise.all([
      session.initializeCompanyEditorSession(),
      session.initializeCompanyEditorSession(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(session.companyEditorSessionReady()).toBe(true);
  });
  it('captures current proof and strips inherited impersonation/JWT authority', async () => {
    fetchMock
      .mockResolvedValueOnce(proof())
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce(proof());
    const response = await session.companyEditorFetch('/graphql', {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer stale', 'X-Workspace-Id': 'B' },
    });
    const headers = fetchMock.mock.calls[1][1].headers as Headers;
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-workspace-id')).toBeNull();
    expect(headers.get('x-exe-company-context')).toBe(contextA);
    expect(headers.get('x-exe-company-csrf')).toBe(csrf);
    expect(await response.text()).toContain('A');
  });
  it('never sends a changed B cookie as a retargeted A operation', async () => {
    fetchMock.mockResolvedValueOnce(proof());
    await session.initializeCompanyEditorSession();
    fetchMock.mockResolvedValueOnce(proof(contextB));
    await expect(
      session.companyEditorFetch('/graphql', { method: 'POST', body: '{}' }),
    ).rejects.toThrow('Company session changed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.companyEditorSessionReady()).toBe(false);
  });
  it('discards a delayed A body after logout/session revocation', async () => {
    fetchMock.mockResolvedValueOnce(proof()).mockResolvedValueOnce(reply());
    const response = await session.companyEditorFetch('/graphql', {
      method: 'POST',
      body: '{}',
    });
    session.revokeCompanyEditorSession();
    await expect(response.text()).rejects.toThrow('Company session changed');
  });
  it('discards a cookie switch while asynchronous body consumption is pending', async () => {
    let releaseBody!: (body: string) => void;
    const delayed = {
      status: 200,
      text: () =>
        new Promise<string>((resolve) => {
          releaseBody = resolve;
        }),
    } as Response;
    fetchMock
      .mockResolvedValueOnce(proof())
      .mockResolvedValueOnce(delayed)
      .mockResolvedValueOnce(proof(contextB));
    const response = await session.companyEditorFetch('/graphql', {
      method: 'POST',
      body: '{}',
    });
    const publication = response.text();
    releaseBody('{"data":{"person":{"id":"A"}}}');
    await expect(publication).rejects.toThrow('Company session changed');
    expect(session.companyEditorSessionReady()).toBe(false);
  });
  it.each(['/auth/login', '/rest/people', 'https://foreign.test/graphql'])(
    'refuses %s without network authority',
    async (url) => {
      await expect(
        session.companyEditorFetch(url, { method: 'POST', body: '{}' }),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('rejects uploads without contacting the server', async () => {
    await expect(
      session.companyEditorFetch('/graphql', {
        method: 'POST',
        body: new FormData(),
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses extra authority fields and clears the current session state', async () => {
    fetchMock.mockResolvedValueOnce(
      proof(contextA, { token: 'not-authority' }),
    );
    await expect(session.initializeCompanyEditorSession()).rejects.toThrow();
    expect(session.companyEditorSessionReady()).toBe(false);
  });
});
