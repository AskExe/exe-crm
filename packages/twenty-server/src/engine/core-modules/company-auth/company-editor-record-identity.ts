export type RecordIdentity = {
  nameSingular: string;
  namePlural: string;
  isSystem: boolean;
};
const protectedNames = new Set([
  'user',
  'workspaceMember',
  'workspace',
  'userWorkspace',
  'role',
  'roleTarget',
  'token',
  'loginToken',
  'apiKey',
  'application',
  'app',
]);
export const companyEditorRecordAllowed = (object: RecordIdentity): boolean =>
  object.isSystem === false && !protectedNames.has(object.nameSingular);
