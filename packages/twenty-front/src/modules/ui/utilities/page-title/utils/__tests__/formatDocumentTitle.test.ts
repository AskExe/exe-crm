import {
  APP_BRAND_NAME,
  formatDocumentTitle,
} from '@/ui/utilities/page-title/utils/formatDocumentTitle';

describe('formatDocumentTitle', () => {
  it('should append the Exe CRM suffix to unbranded titles', () => {
    expect(formatDocumentTitle('Verify')).toBe('Verify | Exe CRM');
    expect(formatDocumentTitle('General - Settings')).toBe(
      'General - Settings | Exe CRM',
    );
  });

  it('should not duplicate the Exe CRM suffix', () => {
    expect(formatDocumentTitle(APP_BRAND_NAME)).toBe(APP_BRAND_NAME);
    expect(formatDocumentTitle('Page Not Found | Exe CRM')).toBe(
      'Page Not Found | Exe CRM',
    );
  });

  it('should fall back to the brand name for empty titles', () => {
    expect(formatDocumentTitle('')).toBe(APP_BRAND_NAME);
    expect(formatDocumentTitle('   ')).toBe(APP_BRAND_NAME);
  });
});
