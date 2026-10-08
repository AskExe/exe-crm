import { renderHook } from '@testing-library/react';
import { FieldMetadataType } from 'twenty-shared/types';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useBuildRecordInputFromRLSPredicates } from '@/object-record/hooks/useBuildRecordInputFromRLSPredicates';
let mockEditor = true;
let mockPredicates: Record<string, unknown>[] = [];
let mockMember: Record<string, unknown> | undefined;
const mockFind = jest.fn();
jest.mock('~/config', () => ({
  get REACT_APP_COMPANY_EDITOR_ENABLED() {
    return mockEditor;
  },
}));
jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => ({ id: 'member' }),
}));
jest.mock('@/object-record/hooks/useFindOneRecord', () => ({
  useFindOneRecord: (args: unknown) => {
    mockFind(args);
    return { record: mockMember };
  },
}));
jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: () => ({
    objectMetadataItem: {
      fields: [{ id: 'member-field', name: 'name', type: 'TEXT' }],
    },
  }),
}));
jest.mock('@/object-record/hooks/useObjectPermissions', () => ({
  useObjectPermissions: () => ({
    objectPermissionsByObjectMetadataId: {
      person: {
        objectMetadataId: 'person',
        rowLevelPermissionPredicates: mockPredicates,
      },
    },
  }),
}));
const object = {
  id: 'person',
  fields: [
    {
      id: 'business-field',
      name: 'intro',
      label: 'Intro',
      type: FieldMetadataType.TEXT,
    },
  ],
} as EnrichedObjectMetadataItem;
const predicate = {
  id: 'predicate',
  objectMetadataId: 'person',
  fieldMetadataId: 'business-field',
  operand: 'CONTAINS',
  value: 'Static',
  positionInRowLevelPermissionPredicateGroup: 0,
};
beforeEach(() => {
  mockEditor = true;
  mockPredicates = [];
  mockMember = undefined;
  mockFind.mockClear();
});
it('skips the unused hosted member fetch when no predicates require it', () => {
  const { result } = renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ skip: true }),
  );
  expect(result.current.buildRecordInputFromRLSPredicates()).toEqual({});
});
it('keeps static predicate conversion while skipping the hosted member fetch', () => {
  mockPredicates = [predicate];
  const { result } = renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ skip: true }),
  );
  expect(result.current.buildRecordInputFromRLSPredicates()).toEqual({
    intro: 'Static',
  });
});
it('does not fetch for another object dynamic predicate', () => {
  mockPredicates = [
    {
      ...predicate,
      objectMetadataId: 'foreign',
      workspaceMemberFieldMetadataId: 'member-field',
    },
  ];
  const { result } = renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ skip: true }),
  );
  expect(result.current.buildRecordInputFromRLSPredicates()).toEqual({});
});
it('still requests and uses the genuine dynamic member field', () => {
  mockPredicates = [
    { ...predicate, workspaceMemberFieldMetadataId: 'member-field' },
  ];
  mockMember = { name: 'Bound member' };
  const { result } = renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ objectRecordId: 'member', skip: false }),
  );
  expect(result.current.buildRecordInputFromRLSPredicates()).toEqual({
    intro: 'Bound member',
  });
});
it('fails closed when required dynamic member data is denied or absent', () => {
  mockPredicates = [
    { ...predicate, workspaceMemberFieldMetadataId: 'member-field' },
  ];
  const { result } = renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ skip: false }),
  );
  expect(() => result.current.buildRecordInputFromRLSPredicates()).toThrow(
    'Current workspace member field value not found',
  );
});
it('keeps ordinary native member fetching unchanged', () => {
  mockEditor = false;
  renderHook(() =>
    useBuildRecordInputFromRLSPredicates({ objectMetadataItem: object }),
  );
  expect(mockFind).toHaveBeenCalledWith(
    expect.objectContaining({ skip: false }),
  );
});
