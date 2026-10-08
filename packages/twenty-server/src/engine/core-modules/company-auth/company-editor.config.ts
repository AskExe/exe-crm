import { companyAuthEnabled } from './company-auth.config';

// The editor is a separate, opt-in browser capability. Enabling the existing
// company REST reader must never enable native editor mutations.
export const companyEditorEnabled = (): boolean => {
  const enabled = process.env.CRM_COMPANY_EDITOR_ENABLED ?? 'false';

  if (enabled !== 'true' && enabled !== 'false') {
    throw new Error('Invalid company editor configuration');
  }

  if (enabled === 'false') return false;

  if (
    !companyAuthEnabled() ||
    process.env.CRM_COMPANY_BROWSER_ENABLED !== 'true'
  ) {
    throw new Error('Invalid company editor configuration');
  }

  return true;
};
