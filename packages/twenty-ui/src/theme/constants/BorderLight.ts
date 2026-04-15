import { BORDER_COMMON } from './BorderCommon';
import { exeFoundryBold } from './ExeFoundryBold';

const b = exeFoundryBold.light.border;

export const BORDER_LIGHT = {
  color: {
    strong: b.color.strong,
    medium: b.color.medium,
    light: b.color.light,
    secondaryInverted: b.color.secondaryInverted,
    inverted: b.color.inverted,
    danger: b.color.danger,
    blue: b.color.blue,
    transparentStrong: b.color.transparentStrong,
  },
  ...BORDER_COMMON,
};
