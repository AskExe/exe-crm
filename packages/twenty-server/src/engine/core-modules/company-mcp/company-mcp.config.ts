export const companyMcpEnabled = () => {
  const value = process.env.CRM_COMPANY_MCP_ENABLED ?? 'false';
  if (
    !['true', 'false'].includes(value) ||
    (value === 'true' && process.env.CRM_COMPANY_MODE !== 'true')
  )
    throw new Error('Invalid company MCP configuration');
  return value === 'true';
};
