import LightNoise from '@assets/themes/light-noise.png';

import { exeFoundryBold } from './ExeFoundryBold';

const bg = exeFoundryBold.light.background;

export const BACKGROUND_LIGHT = {
  noisy: `url(${LightNoise.toString()})`,
  primary: bg.primary,
  secondary: bg.secondary,
  tertiary: bg.tertiary,
  quaternary: bg.quaternary,
  invertedPrimary: bg.invertedPrimary,
  invertedSecondary: bg.invertedSecondary,
  danger: bg.danger,
  transparent: {
    primary: bg.transparent.primary,
    secondary: bg.transparent.secondary,
    strong: bg.transparent.strong,
    medium: bg.transparent.medium,
    light: bg.transparent.light,
    lighter: bg.transparent.lighter,
    danger: bg.transparent.danger,
    blue: bg.transparent.blue,
    orange: bg.transparent.orange,
    success: bg.transparent.success,
  },
  overlayPrimary: bg.overlayPrimary,
  overlaySecondary: bg.overlaySecondary,
  overlayTertiary: bg.overlayTertiary,
  radialGradient: bg.radialGradient,
  radialGradientHover: bg.radialGradientHover,
  primaryInverted: bg.primaryInverted,
  primaryInvertedHover: bg.primaryInvertedHover,
};
