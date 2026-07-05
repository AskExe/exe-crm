// Exe CRM — Exe Foundry Bold theme tokens
// Drop into packages/twenty-ui/src/theme/constants/ and run Twenty's theme generation
// script. Regenerates theme-dark.css and theme-light.css.
//
// All colors expressed in sRGB hex. The Twenty generation script converts to
// color(display-p3 ...) where needed; keep hex as the source of truth for parity
// with the rest of Exe's surfaces (landing, desktop, wiki).

export const exeFoundryBold = {
  // ─── Brand primitives ──────────────────────────────────────────────
  brand: {
    gold: '#F5D76E',        // Exe Gold — accent, CTA, focus
    goldHover: '#FADF85',   // +6% lightness for hover
    goldActive: '#E6C54F',  // −6% for active / pressed
    void: '#0F0E1A',        // canvas (dark)
    stratum: '#1A1832',     // card fill (dark)
    aura: '#6B4C9A',        // purple glow — info / highlight / chart
    bone: '#F0EDE8',        // primary text (dark mode)
    ash: '#A09CAF',         // secondary text (dark mode)
  },

  // ─── Dark mode ─────────────────────────────────────────────────────
  dark: {
    background: {
      noisy: '#0F0E1A',           // full-bleed noise textures use void
      primary: '#0F0E1A',         // canvas
      secondary: '#15142A',       // subtle elevation (hover bands, rails)
      tertiary: '#1A1832',        // cards, sheet surfaces
      quaternary: '#221F3E',      // card hover, popovers
      invertedPrimary: '#F0EDE8', // inverted surface (rare — light-on-dark badges)
      invertedSecondary: '#E8E4DC',
      danger: 'rgba(248, 113, 113, 0.12)',
      transparent: {
        primary: 'rgba(240, 237, 232, 0.04)',
        secondary: 'rgba(240, 237, 232, 0.06)',
        strong: 'rgba(240, 237, 232, 0.12)',
        medium: 'rgba(240, 237, 232, 0.08)',
        light: 'rgba(240, 237, 232, 0.04)',
        lighter: 'rgba(240, 237, 232, 0.02)',
        danger: 'rgba(248, 113, 113, 0.10)',
        blue: 'rgba(107, 76, 154, 0.14)',   // purple stands in for "blue" accent slot
        orange: 'rgba(245, 159, 11, 0.12)',
        success: 'rgba(134, 239, 172, 0.10)',
      },
      overlayPrimary: 'rgba(15, 14, 26, 0.72)',
      overlaySecondary: 'rgba(15, 14, 26, 0.56)',
      overlayTertiary: 'rgba(15, 14, 26, 0.40)',
      radialGradient: 'radial-gradient(1200px 600px at 50% -20%, rgba(107,76,154,0.18), rgba(15,14,26,0) 70%)',
      radialGradientHover: 'radial-gradient(1200px 600px at 50% -20%, rgba(107,76,154,0.26), rgba(15,14,26,0) 70%)',
      primaryInverted: '#F0EDE8',
      primaryInvertedHover: '#E8E4DC',
    },

    font: {
      color: {
        primary: '#F0EDE8',     // body, headings
        secondary: '#A09CAF',   // meta, labels
        tertiary: '#6F6A80',    // placeholder, muted
        light: '#4A4660',       // disabled
        extraLight: '#2E2B42',  // barely-visible
        inverted: '#0F0E1A',    // on-gold, on-light surfaces
        danger: '#F87171',
      },
    },

    border: {
      color: {
        strong: 'rgba(240, 237, 232, 0.16)',
        medium: 'rgba(240, 237, 232, 0.10)',
        light: 'rgba(240, 237, 232, 0.06)',
        secondaryInverted: 'rgba(15, 14, 26, 0.10)',
        inverted: '#0F0E1A',
        danger: 'rgba(248, 113, 113, 0.40)',
        blue: 'rgba(107, 76, 154, 0.40)', // purple in the "blue" slot
        transparentStrong: 'rgba(240, 237, 232, 0.22)',
      },
    },

    boxShadow: {
      color: 'rgba(0, 0, 0, 0.60)',
      light: '0px 1px 2px 0px rgba(0, 0, 0, 0.32)',
      strong: '0px 4px 12px 0px rgba(0, 0, 0, 0.48)',
      underline: '0px 1px 0px 0px rgba(240, 237, 232, 0.16)',
      superHeavy: '0px 16px 48px 0px rgba(0, 0, 0, 0.72), 0px 0px 0px 1px rgba(240, 237, 232, 0.06)',
    },

    // Accent ladder — Twenty uses this for button hover states, highlights, selection.
    // Exe Gold → tinted down toward void for a 12-step ramp.
    accent: {
      primary: '#F5D76E',
      secondary: '#F5D76E',
      tertiary: 'rgba(245, 215, 110, 0.16)',
      quaternary: 'rgba(245, 215, 110, 0.08)',
      accent3570: 'rgba(245, 215, 110, 0.70)',
      accent4060: 'rgba(245, 215, 110, 0.60)',
      accent1: '#1A160A',
      accent2: '#231C0D',
      accent3: '#302512',
      accent4: '#4A381B',
      accent5: '#6A5025',
      accent6: '#8B6930',
      accent7: '#AE833B',
      accent8: '#D1A149',
      accent9: '#F5D76E', // the hero
      accent10: '#FADF85',
      accent11: '#FCE8A2',
      accent12: '#FEF4D0',
    },

    // Tag palette — preserve Twenty's full tag color set but restyled for Exe canvas.
    // Values are low-saturation tints that read clearly on Stratum (#1A1832).
    // Toms: keep the color-name keys identical to Twenty's so downstream tag records
    // don't need data migration. See email-style-spec.md for rationale.

    // State / feedback
    state: {
      success: { text: '#86EFAC', background: 'rgba(134, 239, 172, 0.14)', border: 'rgba(134, 239, 172, 0.32)' },
      warning: { text: '#F59E0B', background: 'rgba(245, 159, 11, 0.14)', border: 'rgba(245, 159, 11, 0.36)' }, // never gold
      error:   { text: '#F87171', background: 'rgba(248, 113, 113, 0.14)', border: 'rgba(248, 113, 113, 0.36)' },
      info:    { text: '#A78BFA', background: 'rgba(107, 76, 154, 0.18)', border: 'rgba(107, 76, 154, 0.40)' },  // Aura family
    },

    // Focus ring — gold at 45% alpha, 2px offset
    focus: {
      ring: '0 0 0 2px rgba(245, 215, 110, 0.45)',
      ringDanger: '0 0 0 2px rgba(248, 113, 113, 0.45)',
    },

    // Auth screen surface tokens — dedicated fills/overlays for the
    // workspace-scope sign-in form (credentials + admin-token tabs).
    // Not part of the primary background/accent scale; scoped to that screen.
    authSurface: {
      inputBackground: '#252340',
      inputBorder: '#2E2C47',
      buttonHover: '#E5C75E',
      error: '#EF4444',
      errorBackground: 'rgba(239, 68, 68, 0.08)',
      focusRing: 'rgba(245, 215, 110, 0.15)',
      hoverOverlay: 'rgba(37, 35, 64, 0.6)',
      hoverBorder: 'rgba(245, 215, 110, 0.3)',
      dividerLine: 'rgba(240, 237, 232, 0.1)',
      spinnerTrack: 'rgba(15, 14, 26, 0.3)',
    },

    name: 'exe-foundry-bold-dark',
  },

  // ─── Light mode ────────────────────────────────────────────────────
  light: {
    background: {
      noisy: '#FAF8F3',
      primary: '#FAF8F3',         // warm off-white canvas (NOT pure white)
      secondary: '#F0EDE8',       // subtle elevation band
      tertiary: '#FFFFFF',        // cards, sheets — pure white reserved for elevation
      quaternary: '#E8E4DC',      // card hover
      invertedPrimary: '#0F0E1A',
      invertedSecondary: '#1A1832',
      danger: 'rgba(220, 38, 38, 0.08)',
      transparent: {
        primary: 'rgba(15, 14, 26, 0.04)',
        secondary: 'rgba(15, 14, 26, 0.06)',
        strong: 'rgba(15, 14, 26, 0.12)',
        medium: 'rgba(15, 14, 26, 0.08)',
        light: 'rgba(15, 14, 26, 0.04)',
        lighter: 'rgba(15, 14, 26, 0.02)',
        danger: 'rgba(220, 38, 38, 0.08)',
        blue: 'rgba(107, 76, 154, 0.12)',
        orange: 'rgba(217, 119, 6, 0.10)',
        success: 'rgba(22, 163, 74, 0.10)',
      },
      overlayPrimary: 'rgba(15, 14, 26, 0.48)',
      overlaySecondary: 'rgba(15, 14, 26, 0.32)',
      overlayTertiary: 'rgba(15, 14, 26, 0.18)',
      radialGradient: 'radial-gradient(1200px 600px at 50% -20%, rgba(107,76,154,0.08), rgba(250,248,243,0) 70%)',
      radialGradientHover: 'radial-gradient(1200px 600px at 50% -20%, rgba(107,76,154,0.14), rgba(250,248,243,0) 70%)',
      primaryInverted: '#0F0E1A',
      primaryInvertedHover: '#1A1832',
    },

    font: {
      color: {
        primary: '#0F0E1A',
        secondary: '#4A4660',
        tertiary: '#6F6A80',
        light: '#A09CAF',
        extraLight: '#D3D0DA',
        inverted: '#FAF8F3',
        danger: '#DC2626',
      },
    },

    border: {
      color: {
        strong: 'rgba(15, 14, 26, 0.16)',
        medium: 'rgba(15, 14, 26, 0.10)',
        light: 'rgba(15, 14, 26, 0.06)',
        secondaryInverted: 'rgba(240, 237, 232, 0.10)',
        inverted: '#F0EDE8',
        danger: 'rgba(220, 38, 38, 0.40)',
        blue: 'rgba(107, 76, 154, 0.40)',
        transparentStrong: 'rgba(15, 14, 26, 0.22)',
      },
    },

    boxShadow: {
      color: 'rgba(15, 14, 26, 0.10)',
      light: '0px 1px 2px 0px rgba(15, 14, 26, 0.06)',
      strong: '0px 4px 12px 0px rgba(15, 14, 26, 0.10)',
      underline: '0px 1px 0px 0px rgba(15, 14, 26, 0.08)',
      superHeavy: '0px 16px 48px 0px rgba(15, 14, 26, 0.18), 0px 0px 0px 1px rgba(15, 14, 26, 0.04)',
    },

    accent: {
      primary: '#B8892B',        // darker gold on light — WCAG AA against #FAF8F3
      secondary: '#B8892B',
      tertiary: 'rgba(184, 137, 43, 0.14)',
      quaternary: 'rgba(184, 137, 43, 0.08)',
      accent3570: 'rgba(184, 137, 43, 0.70)',
      accent4060: 'rgba(184, 137, 43, 0.60)',
      accent1: '#FEF7D9',
      accent2: '#FCEFB8',
      accent3: '#FAE69A',
      accent4: '#F5D76E',
      accent5: '#EBC34F',
      accent6: '#D7A93A',
      accent7: '#B8892B',
      accent8: '#966D1F',
      accent9: '#745317',
      accent10: '#523A10',
      accent11: '#30220A',
      accent12: '#1A1206',
    },

    state: {
      success: { text: '#16A34A', background: 'rgba(22, 163, 74, 0.10)', border: 'rgba(22, 163, 74, 0.32)' },
      warning: { text: '#D97706', background: 'rgba(217, 119, 6, 0.10)', border: 'rgba(217, 119, 6, 0.36)' },
      error:   { text: '#DC2626', background: 'rgba(220, 38, 38, 0.10)', border: 'rgba(220, 38, 38, 0.36)' },
      info:    { text: '#6B4C9A', background: 'rgba(107, 76, 154, 0.10)', border: 'rgba(107, 76, 154, 0.36)' },
    },

    focus: {
      ring: '0 0 0 2px rgba(184, 137, 43, 0.45)',
      ringDanger: '0 0 0 2px rgba(220, 38, 38, 0.45)',
    },

    name: 'exe-foundry-bold-light',
  },

  // ─── Typography (mode-independent) ─────────────────────────────────
  // Load via Google Fonts or self-host. Preload Epilogue 900 + Manrope 400.
  font: {
    family: {
      display: '"Epilogue", "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      body:    '"Manrope", "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      mono:    '"Space Grotesk", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
    },
    weight: {
      regular: 400,
      medium: 500,
      semiBold: 700,
      heavy: 900, // reserved for display h1/h2/brand — Epilogue only
    },
    size: {
      xxs: '10px',
      xs:  '12px',
      sm:  '13px',
      md:  '14px',   // body default
      lg:  '16px',
      xl:  '20px',
      xxl: '28px',
    },
    tracking: {
      display: '-0.02em',  // Epilogue tight headline
      body:    '0',
      label:   '0.08em',   // uppercase Space Grotesk labels
    },
    lineHeight: {
      md: '1.15',  // display
      lg: '1.5',   // body
    },
  },

  // ─── Structural (preserved from Twenty, unchanged) ─────────────────
  // Spacing multiplicator, border radius, icon sizes, animation durations, etc.
  // Toms: keep Twenty's generated values for these — no brand implication.
  // This spec overrides only color, typography, and logo tokens.
};

export default exeFoundryBold;
