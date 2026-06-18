import { Img } from '@react-email/components';
import { getEmailBranding } from 'src/common-style';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  const branding = getEmailBranding();
  const baseUrl = branding.frontBaseUrl;

  return (
    <Img
      src={
        branding.logoUrl ||
        `${baseUrl}/images/icons/exe-crm/exe-crm-logo-480.png`
      }
      alt={`${branding.name} logo`}
      width="160"
      height="37"
      style={logoStyle}
    />
  );
};
