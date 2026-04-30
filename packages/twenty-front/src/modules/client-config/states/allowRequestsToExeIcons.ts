import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const allowRequestsToExeIconsState = createAtomState<boolean>({
  key: 'allowRequestsToExeIcons',
  defaultValue: true,
});
