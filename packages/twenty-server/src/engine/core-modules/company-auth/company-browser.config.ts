import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';

import { type CompanyAuthConfiguration } from './company-auth.config';

export type CompanyBrowserConfiguration = {
  authOrigin: string;
  flowSecret: string;
};

export const readCompanyBrowserConfiguration = (
  configuration: CompanyAuthConfiguration | null,
): CompanyBrowserConfiguration | null => {
  const enabled = process.env.CRM_COMPANY_BROWSER_ENABLED ?? 'false';
  const origin = process.env.CRM_COMPANY_AUTH_ORIGIN;
  const path = process.env.CRM_COMPANY_FLOW_SECRET_FILE;
  if (!['true', 'false'].includes(enabled))
    throw new Error('Invalid company browser configuration');
  if (enabled === 'false') {
    if (origin || path)
      throw new Error('Invalid company browser configuration');
    return null;
  }
  if (
    !configuration ||
    !origin ||
    !path ||
    !/^https:\/\/auth\.[a-z0-9.-]+$/.test(origin)
  )
    throw new Error('Invalid company browser configuration');
  if (
    process.getuid?.() === 0 ||
    !/^[a-z][a-z0-9_-]{2,63}$/.test(configuration.clientId) ||
    !configuration.origin.startsWith('https://crm.')
  )
    throw new Error('Invalid company browser configuration');
  const parsed = new URL(origin);
  const labels = parsed.hostname.split('.');
  if (
    parsed.origin !== origin ||
    parsed.hostname.length > 253 ||
    !/^[a-z]{2,63}$/.test(labels[labels.length - 1] ?? '') ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw new Error('Invalid company browser configuration');
  if (!path.startsWith('/') || realpathSync(path) !== path)
    throw new Error('Invalid company browser configuration');
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 128
    )
      throw new Error('Invalid company browser configuration');
    const flowSecret = readFileSync(descriptor).toString('utf8');
    if (
      !/^[A-Za-z0-9_-]{43,128}$/.test(flowSecret) ||
      flowSecret === configuration.clientSecret
    )
      throw new Error('Invalid company browser configuration');
    return Object.freeze({ authOrigin: origin, flowSecret });
  } finally {
    closeSync(descriptor);
  }
};
