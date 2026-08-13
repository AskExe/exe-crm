/**
 * Public-suffix-aware registrable-domain ("apex") derivation.
 *
 * A naive `hostname.split('.').slice(-2)` is WRONG for multi-part public
 * suffixes: for `crm.company.co.uk` it yields `co.uk`, so the Exe SSO hand-off
 * builds `auth.co.uk` instead of `auth.company.co.uk` and login is broken for
 * every customer on such a domain (bug ee7b8871). We keep three labels when the
 * last two form a known multi-part public suffix.
 *
 * This is a documented allowlist of common multi-part TLDs, NOT the full Public
 * Suffix List — bundling `psl` and keeping it in sync across the CRM / Wiki /
 * ERP / Auth static pages is not worth it; this covers the registrable suffixes
 * our customers actually use. It MUST stay in sync with exe-auth's
 * `auth-redirect.js` apexDomain() and exe-wiki's `frontend/index.html`, since
 * all of them derive `auth.<customer-apex>`.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'me.uk',
  'ltd.uk',
  'plc.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'id.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'govt.nz',
  'ac.nz',
  'co.za',
  'org.za',
  'net.za',
  'gov.za',
  'ac.za',
  'com.br',
  'net.br',
  'org.br',
  'gov.br',
  'co.jp',
  'or.jp',
  'ne.jp',
  'go.jp',
  'ac.jp',
  'co.in',
  'net.in',
  'org.in',
  'gov.in',
  'ac.in',
  'com.sg',
  'edu.sg',
  'gov.sg',
  'net.sg',
  'org.sg',
  'com.my',
  'net.my',
  'org.my',
  'gov.my',
  'edu.my',
  'com.hk',
  'edu.hk',
  'gov.hk',
  'net.hk',
  'org.hk',
  'com.mx',
  'gob.mx',
  'org.mx',
  'net.mx',
  'com.tr',
  'net.tr',
  'org.tr',
  'gov.tr',
  'co.id',
  'or.id',
  'web.id',
  'ac.id',
  'go.id',
  'co.kr',
  'or.kr',
  'ne.kr',
  'go.kr',
]);

/**
 * Derive the registrable apex domain from a hostname.
 *
 *   crm.hygo.co       → hygo.co
 *   crm.company.co.uk → company.co.uk   (NOT co.uk)
 *   localhost         → localhost
 */
export const getRegistrableDomain = (hostname: string): string => {
  const normalizedHost = String(hostname ?? '').toLowerCase();
  const parts = normalizedHost.split('.').filter(Boolean);

  if (parts.length <= 2) {
    return normalizedHost;
  }

  const lastTwo = parts.slice(-2).join('.');

  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  return lastTwo;
};
