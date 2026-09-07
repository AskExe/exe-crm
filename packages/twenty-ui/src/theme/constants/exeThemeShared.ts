// Shared brand tokens, read from the vendored @askexenow/exe-theme.
//
// exe-crm is the FOUNDER-APPROVED reference look for the whole product line.
// The small subset of tokens below (backgrounds, accent, text, status colours
// and the three font stacks) is now also owned by @askexenow/exe-theme, which
// was reconciled *from* this repo's ExeFoundryBold.ts. Reading them from the
// vendored copy stops exe-crm, exe-erp and exe-wiki from drifting apart.
//
// Scope: this module owns ONLY that shared subset. exe-crm's much larger token
// surface (the accent 1-12 ladder, state colours, box shadows, light mode,
// spacing, structural tokens) has no equivalent upstream and stays exactly as
// it is in ExeFoundryBold.ts.
//
// Resync the vendored JSON with scripts/sync-exe-theme.sh.

import { exeThemeTokens as tokens } from './exe-theme/tokens';

/**
 * exe-theme serialises font stacks with single-quoted family names
 * ('Epilogue', ...), while exe-crm has always emitted double-quoted names
 * ("Epilogue", ...) into theme-dark.css / theme-light.css via
 * scripts/generateThemeCss.ts.
 *
 * The two are equivalent CSS and render identically, but they are not
 * byte-identical, and exe-crm's generated CSS is the reference artefact — it
 * must not churn just because the value moved house. So the family LIST comes
 * from exe-theme (single source of truth: change it upstream and every product
 * follows), and only the quote style is normalised back to exe-crm's existing
 * serialisation.
 *
 * Follow-up owned by exe: store the double-quoted spelling upstream in
 * @askexenow/exe-theme so this normalisation can be deleted.
 */
const toDoubleQuoted = (fontStack: string): string =>
  fontStack.replace(/'/g, '"');

export const EXE_THEME_SHARED = {
  background: {
    primary: tokens.colors.bgPrimary,
    secondary: tokens.colors.bgSecondary,
    tertiary: tokens.colors.bgTertiary,
  },
  accent: {
    base: tokens.colors.accent,
    hover: tokens.colors.accentHover,
    active: tokens.colors.accentActive,
  },
  text: {
    primary: tokens.colors.text,
    muted: tokens.colors.textMuted,
    inverted: tokens.colors.textInverted,
  },
  status: {
    error: tokens.colors.error,
    success: tokens.colors.success,
  },
  font: {
    display: toDoubleQuoted(tokens.fonts.heading),
    body: toDoubleQuoted(tokens.fonts.body),
    mono: toDoubleQuoted(tokens.fonts.mono),
  },
} as const;
