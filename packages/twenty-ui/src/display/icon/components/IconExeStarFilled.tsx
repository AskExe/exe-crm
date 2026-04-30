import { useContext } from 'react';

import IconExeStarFilledRaw from '@assets/icons/exe-star-filled.svg?react';
import { type IconComponentProps } from '@ui/display/icon/types/IconComponent';
import { ThemeContext } from '@ui/theme-constants';

type IconExeStarFilledProps = Pick<IconComponentProps, 'size' | 'stroke'>;

export const IconExeStarFilled = (props: IconExeStarFilledProps) => {
  const { theme } = useContext(ThemeContext);
  const size = props.size ?? 24;
  const stroke = props.stroke ?? theme.icon.stroke.md;

  return (
    <IconExeStarFilledRaw height={size} width={size} strokeWidth={stroke} />
  );
};
