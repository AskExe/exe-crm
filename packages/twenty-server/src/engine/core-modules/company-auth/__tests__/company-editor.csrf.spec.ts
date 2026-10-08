import { type CompanyAuthConfiguration } from '../company-auth.config';
import { sealCompanyFlow } from '../company-browser.protocol';
import {
  issueCompanyEditorCsrf,
  verifyCompanyEditorCsrf,
} from '../company-editor.csrf';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const configuration: CompanyAuthConfiguration = {
  companyId: uuid,
  workspaceId: uuid,
  nativeSchema: 'workspace_alpha',
  bindingId: uuid,
  generationId: uuid,
  audience: 'crm-alpha',
  clientId: 'crm-alpha',
  origin: 'https://crm.alpha.example',
  brokerUrl: 'http://broker:3000',
  authorityUrl: 'http://core:3000',
  clientSecret: 'x'.repeat(43),
  bindings: new Map(),
};
const browser = {
  authOrigin: 'https://auth.alpha.example',
  flowSecret: 'y'.repeat(43),
};
const session = 'exs_' + 'A'.repeat(43);
const context = 'a'.repeat(64);

describe('company editor CSRF transport proof', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T00:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('issues distinct nonces and verifies only the captured session/context', () => {
    const first = issueCompanyEditorCsrf(
      configuration,
      browser,
      session,
      context,
    );
    const second = issueCompanyEditorCsrf(
      configuration,
      browser,
      session,
      context,
    );

    expect(first).not.toBe(second);
    expect(first).not.toContain(session);
    expect(() =>
      verifyCompanyEditorCsrf(first, configuration, browser, session, context),
    ).not.toThrow();
    expect(() =>
      verifyCompanyEditorCsrf(
        first,
        configuration,
        browser,
        'exs_' + 'B'.repeat(43),
        context,
      ),
    ).toThrow();
    expect(() =>
      verifyCompanyEditorCsrf(
        first,
        configuration,
        browser,
        session,
        'b'.repeat(64),
      ),
    ).toThrow();
  });

  it.each([
    'companyId',
    'workspaceId',
    'bindingId',
    'generationId',
    'audience',
    'clientId',
    'origin',
  ] as const)('refuses a proof copied across %s', (key) => {
    const proof = issueCompanyEditorCsrf(
      configuration,
      browser,
      session,
      context,
    );

    expect(() =>
      verifyCompanyEditorCsrf(
        proof,
        { ...configuration, [key]: configuration[key] + '-other' },
        browser,
        session,
        context,
      ),
    ).toThrow();
  });

  it('refuses expiration, clock rollback, tampering and flow-domain tokens', () => {
    const proof = issueCompanyEditorCsrf(
      configuration,
      browser,
      session,
      context,
    );

    jest.advanceTimersByTime(300_000);
    expect(() =>
      verifyCompanyEditorCsrf(proof, configuration, browser, session, context),
    ).toThrow();
    jest.setSystemTime(new Date('2026-10-07T23:59:59Z'));
    expect(() =>
      verifyCompanyEditorCsrf(proof, configuration, browser, session, context),
    ).toThrow();
    jest.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    for (const value of [
      undefined,
      proof + 'x',
      proof.replace(/.$/, proof.endsWith('A') ? 'B' : 'A'),
      sealCompanyFlow(configuration, browser, 'A'.repeat(43), 'B'.repeat(43)),
    ]) {
      expect(() =>
        verifyCompanyEditorCsrf(
          value,
          configuration,
          browser,
          session,
          context,
        ),
      ).toThrow();
    }
  });
});
