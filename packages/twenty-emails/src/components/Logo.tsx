import { Img } from '@react-email/components';

const logoStyle = {
  marginBottom: '40px',
};

export const Logo = () => {
  const baseUrl = process.env.FRONT_BASE_URL || 'https://crm.askexe.com';

  return (
    <Img
      src={`${baseUrl}/images/icons/exe-crm/exe-crm-logo-480.png`}
      alt="Exe CRM logo"
      width="160"
      height="37"
      style={logoStyle}
    />
  );
};
