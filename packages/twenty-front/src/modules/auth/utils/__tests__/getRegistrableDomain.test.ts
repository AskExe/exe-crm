import { getRegistrableDomain } from '@/auth/utils/getRegistrableDomain';

describe('getRegistrableDomain', () => {
  describe.each([
    ['crm.askexe.com', 'askexe.com'],
    ['crm.hygo.co', 'hygo.co'],
    ['wiki.example.org', 'example.org'],
    ['deep.nested.sub.example.com', 'example.com'],
  ])('single-part public suffix', (hostname, expected) => {
    it(`resolves ${hostname} to ${expected}`, () => {
      expect(getRegistrableDomain(hostname)).toBe(expected);
    });
  });

  // bug ee7b8871: a naive slice(-2) yields "co.uk" here, so the Exe SSO
  // hand-off would build auth.co.uk and break login for these customers.
  describe.each([
    ['crm.company.co.uk', 'company.co.uk'],
    ['erp.company.org.uk', 'company.org.uk'],
    ['crm.company.com.au', 'company.com.au'],
    ['crm.company.co.nz', 'company.co.nz'],
    ['crm.company.com.br', 'company.com.br'],
    ['crm.company.co.jp', 'company.co.jp'],
    ['crm.company.com.my', 'company.com.my'],
    ['crm.company.co.id', 'company.co.id'],
  ])('multi-part public suffix', (hostname, expected) => {
    it(`resolves ${hostname} to ${expected}`, () => {
      expect(getRegistrableDomain(hostname)).toBe(expected);
    });
  });

  describe.each([
    ['localhost', 'localhost'],
    ['askexe.com', 'askexe.com'],
    ['co.uk', 'co.uk'],
  ])('hosts with two or fewer labels are returned unchanged', (hostname, expected) => {
    it(`resolves ${hostname} to ${expected}`, () => {
      expect(getRegistrableDomain(hostname)).toBe(expected);
    });
  });

  it('lowercases mixed-case hostnames', () => {
    expect(getRegistrableDomain('CRM.Company.CO.UK')).toBe('company.co.uk');
  });

  it('ignores a trailing dot on a fully qualified hostname', () => {
    expect(getRegistrableDomain('crm.company.co.uk.')).toBe('company.co.uk');
  });

  it('returns an empty string for an empty hostname', () => {
    expect(getRegistrableDomain('')).toBe('');
  });
});
