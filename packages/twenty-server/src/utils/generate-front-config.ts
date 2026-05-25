import * as fs from 'fs';
import * as path from 'path';

import { config } from 'dotenv';
config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  override: true,
});

interface BrandingConfig {
  companyName: string;
  logo: string;
  favicon: string;
  colors: {
    accent: string;
    background: string;
    text: string;
    sidebar: string;
    border: string;
  };
  fonts: {
    heading: string;
    body: string;
    mono: string;
  };
}

const BRANDING_DEFAULTS: BrandingConfig = {
  companyName: 'Exe CRM',
  logo: '/images/icons/exe-crm/favicon-32.png',
  favicon: '/images/icons/exe-crm/favicon-32.png',
  colors: {
    accent: '#F5D76E',
    background: '#0F0E1A',
    text: '#F0EDE8',
    sidebar: '#0A0916',
    border: '#1E1D2E',
  },
  fonts: {
    heading: 'Epilogue',
    body: 'Manrope',
    mono: 'Space Grotesk',
  },
};

function loadBranding(): BrandingConfig {
  const configPath =
    process.env.BRANDING_CONFIG_PATH || '/app/branding.json';

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw);

      return {
        companyName: parsed.companyName || BRANDING_DEFAULTS.companyName,
        logo: parsed.logo || BRANDING_DEFAULTS.logo,
        favicon: parsed.favicon || parsed.logo || BRANDING_DEFAULTS.favicon,
        colors: { ...BRANDING_DEFAULTS.colors, ...parsed.colors },
        fonts: { ...BRANDING_DEFAULTS.fonts, ...parsed.fonts },
      };
    }
  } catch {
    // oxlint-disable-next-line no-console
    console.log(`[Branding] Failed to load ${configPath}, using defaults`);
  }

  return BRANDING_DEFAULTS;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');

  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);

  return `#${Math.round(r + (255 - r) * amount)
    .toString(16)
    .padStart(2, '0')}${Math.round(g + (255 - g) * amount)
    .toString(16)
    .padStart(2, '0')}${Math.round(b + (255 - b) * amount)
    .toString(16)
    .padStart(2, '0')}`;
}

function generateBrandingBlock(branding: BrandingConfig): string {
  const { accent, background, text } = branding.colors;
  const bgSecondary = lighten(background, 0.04);
  const bgTertiary = lighten(background, 0.07);

  const fontFamilies = [branding.fonts.heading, branding.fonts.body, branding.fonts.mono]
    .filter(Boolean)
    .map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`)
    .join('&');

  return `<!-- BEGIN: Branding -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${fontFamilies}&display=swap" rel="stylesheet">
    <style id="branding-overrides">
      .dark {
        --t-accent-primary: ${accent};
        --t-background-primary: ${background};
        --t-background-secondary: ${bgSecondary};
        --t-background-tertiary: ${bgTertiary};
        --t-font-color-primary: ${text};
        --t-font-color-secondary: ${rgba(text, 0.6)};
        --t-font-color-tertiary: ${rgba(text, 0.35)};
        --t-border-color-strong: ${rgba(text, 0.16)};
        --t-border-color-medium: ${rgba(text, 0.10)};
        --t-border-color-light: ${rgba(text, 0.06)};
        --t-background-primary-inverted: ${text};
      }
      .light {
        --t-accent-primary: ${accent};
      }
    </style>
    <script>window.__BRANDING__=${JSON.stringify({ companyName: branding.companyName, logo: branding.logo })};</script>
    <!-- END: Branding -->`;
}

export function generateFrontConfig(): void {
  const configObject = {
    window: {
      _env_: {
        REACT_APP_SERVER_BASE_URL: process.env.SERVER_URL,
      },
    },
  };

  const configString = `<!-- BEGIN: Exe CRM Config -->
    <script id="exe-crm-env-config">
      window._env_ = ${JSON.stringify(configObject.window._env_, null, 2)};
    </script>
    <!-- END: Exe CRM Config -->`;

  const branding = loadBranding();
  const brandingString = generateBrandingBlock(branding);

  const distPath = path.join(__dirname, '..', 'front');
  const indexPath = path.join(distPath, 'index.html');

  try {
    let indexContent = fs.readFileSync(indexPath, 'utf8');

    indexContent = indexContent.replace(
      /<!-- BEGIN: (?:Twenty|Exe CRM) Config -->[\s\S]*?<!-- END: (?:Twenty|Exe CRM) Config -->/,
      configString,
    );

    indexContent = indexContent.replace(
      /<!-- BEGIN: Branding -->[\s\S]*?<!-- END: Branding -->/,
      brandingString,
    );

    // Replace <title> with branding company name
    indexContent = indexContent.replace(
      /<title>[^<]*<\/title>/,
      `<title>${branding.companyName}</title>`,
    );

    fs.writeFileSync(indexPath, indexContent, 'utf8');

    // oxlint-disable-next-line no-console
    console.log(`[Branding] Injected config for "${branding.companyName}"`);
  } catch {
    // oxlint-disable-next-line no-console
    console.log(
      'Frontend build not found or not writable, assuming it is served independently',
    );
  }
}
