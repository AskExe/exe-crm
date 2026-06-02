import { useEffect, useMemo, useState } from 'react';

import { type ColorScheme } from '@/workspace-member/types/WorkspaceMember';
import { isUndefinedOrNull } from '~/utils/isUndefinedOrNull';

export const useSystemColorScheme = (): ColorScheme => {
  const mediaQuery = useMemo(
    () => window.matchMedia('(prefers-color-scheme: dark)'),
    [],
  );

  // Exe Foundry Bold: always dark. Ignore system preference.
  const [preferredColorScheme, setPreferredColorScheme] = useState<ColorScheme>(
    'Dark',
  );

  useEffect(() => {
    if (isUndefinedOrNull(window.matchMedia)) {
      return;
    }

    const handleChange = (event: MediaQueryListEvent): void => {
      setPreferredColorScheme(event.matches ? 'Dark' : 'Light');
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [mediaQuery]);

  return preferredColorScheme;
};
