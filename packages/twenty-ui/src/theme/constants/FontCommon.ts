import { exeFoundryBold } from './ExeFoundryBold';

const f = exeFoundryBold.font;

export const FONT_COMMON = {
  size: {
    xxs: f.size.xxs,
    xs: f.size.xs,
    sm: f.size.sm,
    md: f.size.md,
    lg: f.size.lg,
    xl: f.size.xl,
    xxl: f.size.xxl,
  },
  weight: {
    regular: f.weight.regular,
    medium: f.weight.medium,
    semiBold: f.weight.semiBold,
  },
  family: f.family.body,
};
