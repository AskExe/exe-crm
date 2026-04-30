import { useContext } from 'react';

import IconExeStarRaw from '@assets/icons/exe-star.svg?react';
import { type IconComponentProps } from '@ui/display/icon/types/IconComponent';
import { ThemeContext } from '@ui/theme-constants';

type IconExeStarProps = Pick<IconComponentProps, 'size' | 'stroke'>;

export const IconExeStar = (props: IconExeStarProps) => {
  const { theme } = useContext(ThemeContext);
  const size = props.size ?? 24;
  const stroke = props.stroke ?? theme.icon.stroke.md;

  return <IconExeStarRaw height={size} width={size} strokeWidth={stroke} />;
};
