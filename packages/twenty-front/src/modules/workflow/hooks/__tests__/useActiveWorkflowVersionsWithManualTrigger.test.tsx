import React from 'react';

import { useActiveWorkflowVersionsWithManualTrigger } from '@/workflow/hooks/useActiveWorkflowVersionsWithManualTrigger';
import { renderHook } from '@testing-library/react';
import { PermissionFlagType } from '~/generated-metadata/graphql';

const mockUseFindManyRecords = jest.fn();

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: unknown) => mockUseFindManyRecords(options),
}));

const mockPermissionFlags: PermissionFlagType[] = [];

jest.mock('@/settings/roles/hooks/useHasPermissionFlag', () => ({
  useHasPermissionFlag: (permissionFlag?: PermissionFlagType) =>
    !permissionFlag || mockPermissionFlags.includes(permissionFlag),
}));

describe('useActiveWorkflowVersionsWithManualTrigger', () => {
  beforeEach(() => {
    mockUseFindManyRecords.mockReset();
    mockUseFindManyRecords.mockReturnValue({ records: [] });
    mockPermissionFlags.length = 0;
  });

  it('queries workflow versions when the role holds the WORKFLOWS flag', () => {
    mockPermissionFlags.push(PermissionFlagType.WORKFLOWS);

    renderHook(() => useActiveWorkflowVersionsWithManualTrigger({}));

    expect(mockUseFindManyRecords).toHaveBeenCalledWith(
      expect.objectContaining({ skip: false }),
    );
  });

  it('skips the query when the role lacks the WORKFLOWS flag', () => {
    renderHook(() => useActiveWorkflowVersionsWithManualTrigger({}));

    expect(mockUseFindManyRecords).toHaveBeenCalledWith(
      expect.objectContaining({ skip: true }),
    );
  });

  it('stays skipped when the caller already asked to skip', () => {
    mockPermissionFlags.push(PermissionFlagType.WORKFLOWS);

    renderHook(() =>
      useActiveWorkflowVersionsWithManualTrigger({ skip: true }),
    );

    expect(mockUseFindManyRecords).toHaveBeenCalledWith(
      expect.objectContaining({ skip: true }),
    );
  });
});
