/* oxlint-disable twenty/no-hardcoded-colors */
/*
 * Exe CRM — email theme
 * Drop into: packages/twenty-emails/src/common-style.ts
 *
 * Email-safe constraints: web-safe fonts only (Trebuchet stack), inline styles,
 * light-mode only. See email-style-spec.md for rationale.
 */

const exe = {
  void: '#0F0E1A',
  stratum: '#1A1832',
  gold: '#F5D76E',
  goldHighlight: '#FEF4D0',
  aura: '#6B4C9A',
  bone: '#F0EDE8',
  canvas: '#FAF8F3',
  white: '#FFFFFF',
  textPrimary: '#0F0E1A',
  textSecondary: '#4A4660',
  textTertiary: '#6F6A80',
  borderLight: '#E8E4DC',
  borderMedium: '#D3D0DA',
};

export const emailTheme = {
  font: {
    colors: {
      highlighted: exe.textPrimary,
      primary: exe.textSecondary,
      tertiary: exe.textTertiary,
      inverted: exe.void, // Exe uses dark text on gold CTA — inverted means "on-brand-accent"
      blue: exe.aura,     // Aura stands in for the "blue" slot (inline links)
    },
    // Trebuchet is the last web-safe sans that has real weight contrast; see:
    // https://templates.mailchimp.com/design/typography/
    family: '"Trebuchet MS", "Helvetica Neue", Arial, sans-serif',
    weight: {
      regular: 400,
      bold: 600,
    },
    size: {
      sm: '12px',
      md: '14px',
      lg: '16px',
      xl: '24px',
    },
    lineHeight: '1.5',
  },
  border: {
    radius: { sm: '4px', md: '8px' },
    color: { highlighted: exe.borderLight },
  },
  background: {
    colors: {
      body: exe.canvas,
      card: exe.white,
      highlight: exe.goldHighlight,
    },
    button: exe.gold,           // primary CTA fill
    buttonTextColor: exe.void,  // text color on primary CTA
    transparent: {
      medium: 'rgba(15, 14, 26, 0.08)',
      light: 'rgba(15, 14, 26, 0.04)',
    },
  },
  brand: {
    name: 'Exe CRM',
    tagline: "Hire the team you couldn't afford.",
    footerUrl: 'https://crm.askexe.com',
    logoUrl: 'https://crm.askexe.com/email-assets/exe-crm-logo-480.png',
    logoWidth: 120,
    logoHeight: 28,
  },
  spacing: {
    containerMaxWidth: '600px',
    contentPaddingY: '32px',
    contentPaddingX: '32px',
    buttonPaddingY: '12px',
    buttonPaddingX: '24px',
  },
};
