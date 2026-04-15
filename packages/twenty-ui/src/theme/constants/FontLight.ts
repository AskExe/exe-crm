import { exeFoundryBold } from './ExeFoundryBold';
import { FONT_COMMON } from './FontCommon';

const f = exeFoundryBold.light.font;

export const FONT_LIGHT = {
  color: {
    primary: f.color.primary,
    secondary: f.color.secondary,
    tertiary: f.color.tertiary,
    light: f.color.light,
    extraLight: f.color.extraLight,
    inverted: f.color.inverted,
    danger: f.color.danger,
  },
  ...FONT_COMMON,
};
