import { extractDomainFromLink } from 'src/modules/contact-creation-manager/utils/extract-domain-from-link.util';

describe('extractDomainFromLink', () => {
  it('should extract domain from link', () => {
    const link = 'https://www.askexe.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('askexe.com');
  });

  it('should extract domain from link without www', () => {
    const link = 'https://askexe.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('askexe.com');
  });

  it('should extract domain from link without protocol', () => {
    const link = 'askexe.com';
    const result = extractDomainFromLink(link);

    expect(result).toBe('askexe.com');
  });

  it('should extract domain from link with path', () => {
    const link = 'https://askexe.com/about';
    const result = extractDomainFromLink(link);

    expect(result).toBe('askexe.com');
  });
});
