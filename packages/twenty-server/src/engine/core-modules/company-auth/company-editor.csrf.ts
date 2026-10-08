import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { type CompanyAuthConfiguration } from './company-auth.config';
import { type CompanyBrowserConfiguration } from './company-browser.config';
import {
  CompanyBrowserError,
  COMPANY_SESSION_TOKEN,
} from './company-browser.protocol';
import {
  COMPANY_EDITOR_ACCESS_FIELDS,
  type CompanyEditorAccess,
} from './company-editor-access.contract';

const MAXIMUM_AGE_SECONDS = 300;
const TOKEN = /^([A-Za-z0-9_-]{43})\.([1-9][0-9]{9})\.([A-Za-z0-9_-]{43})$/;

export const companyEditorContextDigest = (
  authority: CompanyEditorAccess,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        COMPANY_EDITOR_ACCESS_FIELDS.map((field) => authority[field]),
      ),
    )
    .digest('hex');

// contextDigest is computed server-side from the complete, freshly validated
// editor envelope. It is a comparison value, never a workspace selector.
const signature = (
  configuration: CompanyAuthConfiguration,
  browser: CompanyBrowserConfiguration,
  session: string,
  contextDigest: string,
  nonce: string,
  expires: number,
): string => {
  if (
    !COMPANY_SESSION_TOKEN.test(session) ||
    !/^[0-9a-f]{64}$/.test(contextDigest)
  )
    throw new CompanyBrowserError(403);

  return createHmac('sha256', browser.flowSecret)
    .update(
      JSON.stringify([
        'exe-crm-company-editor-csrf-v1',
        configuration.origin,
        configuration.clientId,
        configuration.audience,
        configuration.companyId,
        configuration.workspaceId,
        configuration.bindingId,
        configuration.generationId,
        session,
        contextDigest,
        nonce,
        expires,
      ]),
    )
    .digest('base64url');
};

export const issueCompanyEditorCsrf = (
  configuration: CompanyAuthConfiguration,
  browser: CompanyBrowserConfiguration,
  session: string,
  contextDigest: string,
): string => {
  const nonce = randomBytes(32).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + MAXIMUM_AGE_SECONDS;

  return `${nonce}.${expires}.${signature(configuration, browser, session, contextDigest, nonce, expires)}`;
};

export const verifyCompanyEditorCsrf = (
  raw: string | undefined,
  configuration: CompanyAuthConfiguration,
  browser: CompanyBrowserConfiguration,
  session: string,
  contextDigest: string,
): void => {
  const parsed = raw?.match(TOKEN);

  if (!parsed) throw new CompanyBrowserError(403);

  const [, nonce, expiry, supplied] = parsed;
  const expires = Number(expiry);
  const now = Date.now() / 1000;

  if (expires <= now || expires > now + MAXIMUM_AGE_SECONDS)
    throw new CompanyBrowserError(403);

  const expected = signature(
    configuration,
    browser,
    session,
    contextDigest,
    nonce,
    expires,
  );

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)))
    throw new CompanyBrowserError(403);
};
