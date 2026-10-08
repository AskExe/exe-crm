import { companyEditorEnabled } from '../company-editor.config';

describe('company editor configuration', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
    delete process.env.CRM_COMPANY_EDITOR_ENABLED;
    delete process.env.CRM_COMPANY_MODE;
    delete process.env.CRM_COMPANY_BROWSER_ENABLED;
  });

  afterEach(() => {
    process.env = original;
  });

  it('does not upgrade the existing company browser or REST reader', () => {
    process.env.CRM_COMPANY_MODE = 'true';
    process.env.CRM_COMPANY_BROWSER_ENABLED = 'true';
    expect(companyEditorEnabled()).toBe(false);
  });

  it('requires an explicit editor flag and both existing boundaries', () => {
    process.env.CRM_COMPANY_EDITOR_ENABLED = 'true';
    expect(() => companyEditorEnabled()).toThrow();
    process.env.CRM_COMPANY_MODE = 'true';
    expect(() => companyEditorEnabled()).toThrow();
    process.env.CRM_COMPANY_BROWSER_ENABLED = 'true';
    expect(companyEditorEnabled()).toBe(true);
  });

  it.each(['TRUE', '1', '', ' true'])('refuses malformed flag %p', (value) => {
    process.env.CRM_COMPANY_EDITOR_ENABLED = value;
    expect(() => companyEditorEnabled()).toThrow();
  });
});
