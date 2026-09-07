// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source : AskExe/exe-os  packages/exe-theme/tokens.json
// Branch : fix/exe-theme-reconcile-crm
// Commit : 47d54b58
// Resync : run packages/twenty-ui/scripts/sync-exe-theme.sh
//
// Generated from the vendored tokens.json next to this file. It exists as a
// .ts module rather than a raw JSON import because these tokens are evaluated
// by four different toolchains (tsx for the theme-CSS generator, Vite/Linaria
// at build time for twenty-front, Jest/SWC in tests, and the Nest server), and
// a JSON import is the one thing that does not resolve identically in all of
// them. tokens.json stays the canonical vendored artefact.

export const exeThemeTokens = {
  colors: {
    bgPrimary: '#0F0E1A',
    bgSecondary: '#15142A',
    bgTertiary: '#1A1832',
    accent: '#F5D76E',
    accentHover: '#FADF85',
    accentActive: '#E6C54F',
    text: '#F0EDE8',
    textMuted: '#A09CAF',
    textInverted: '#0F0E1A',
    border: 'rgba(240, 237, 232, 0.1)',
    error: '#F87171',
    success: '#86EFAC',
    inputBg: 'rgba(255, 255, 255, 0.05)',
    inputBgFocus: 'rgba(255, 255, 255, 0.07)',
    tabActiveBg: 'rgb(37, 35, 64)',
    tabBg: 'rgba(255, 255, 255, 0.05)',
  },
  fonts: {
    heading:
      "'Epilogue', 'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    body: "'Manrope', 'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    mono: "'Space Grotesk', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  spacing: {
    radius: '8px',
    radiusSm: '6px',
    radiusLg: '12px',
    inputHeight: '42px',
    btnHeight: '42px',
    cardMaxWidth: '480px',
    loginCardMaxWidth: '340px',
  },
  typography: {
    h1: '30px',
    h2: '24px',
    h3: '20px',
    body: '16px',
    small: '14px',
    caption: '12px',
    headingWeight: 700,
    headingLetterSpacing: '-0.02em',
    headingTransform: 'uppercase',
  },
} as const;
