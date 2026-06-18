import { type I18n } from '@lingui/core';
import { Column, Container, Row } from '@react-email/components';
import { getEmailBranding } from 'src/common-style';
import { Link } from 'src/components/Link';
import { ShadowText } from 'src/components/ShadowText';

const footerContainerStyle = {
  marginTop: '12px',
};

type FooterProps = {
  i18n: I18n;
};

export const Footer = ({ i18n }: FooterProps) => {
  const branding = getEmailBranding();

  const footerLinks = [
    {
      href: branding.websiteUrl,
      value: i18n._('Website'),
      ariaLabel: i18n._('Visit the website'),
    },
    {
      href: branding.githubUrl,
      value: i18n._('Github'),
      ariaLabel: i18n._('Visit the GitHub repository'),
    },
    {
      href: branding.docsUserGuideUrl,
      value: i18n._('User guide'),
      ariaLabel: i18n._('Read the user guide'),
    },
    {
      href: branding.docsUrl,
      value: i18n._('Developers'),
      ariaLabel: i18n._('Visit the developer documentation'),
    },
  ].filter((linkItem) => linkItem.href);

  return (
    <Container style={footerContainerStyle}>
      <Row>
        {footerLinks.map((linkItem) => (
          <Column key={linkItem.value}>
            <ShadowText>
              <Link
                href={linkItem.href}
                value={linkItem.value}
                aria-label={linkItem.ariaLabel}
              />
            </ShadowText>
          </Column>
        ))}
      </Row>
      <ShadowText>
        <>
          {branding.name}
          <br />
          {i18n._('San Francisco / Paris')}
        </>
      </ShadowText>
    </Container>
  );
};
