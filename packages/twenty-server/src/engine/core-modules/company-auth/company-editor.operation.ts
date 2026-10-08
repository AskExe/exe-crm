import {
  type DocumentNode,
  type GraphQLSchema,
  type SelectionSetNode,
  Kind,
} from 'graphql';

import { CompanyBrowserError } from './company-browser.protocol';

export const COMPANY_EDITOR_CAPABILITY = 'companyEditorCapability';

// Capabilities are attached to native schema fields by server source. Neither
// operation names nor caller headers can turn an auth/settings field into CRUD.
export const companyEditorOperation = (
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName: string | undefined,
  api: 'records' | 'metadata',
): 'read' | 'write' => {
  const operations = document.definitions.filter(
    (definition) => definition.kind === Kind.OPERATION_DEFINITION,
  );
  const operation = operations[0];

  if (
    operations.length !== 1 ||
    !operation ||
    (operationName !== undefined && operation.name?.value !== operationName) ||
    operation.operation === 'subscription' ||
    (api === 'metadata' && operation.operation !== 'query')
  )
    throw new CompanyBrowserError(403);

  const write = operation.operation === 'mutation';
  const root = write ? schema.getMutationType() : schema.getQueryType();
  if (!root) throw new CompanyBrowserError(403);
  const fragments = new Map(
    document.definitions.flatMap((definition) =>
      definition.kind === Kind.FRAGMENT_DEFINITION
        ? [[definition.name.value, definition] as const]
        : [],
    ),
  );
  let visited = 0;
  let fields = 0;
  const inspect = (
    selection: SelectionSetNode,
    ancestors: Set<string>,
  ): void => {
    for (const node of selection.selections) {
      if (++visited > 128) throw new CompanyBrowserError(403);
      if (node.kind === Kind.FIELD) {
        fields += 1;
        const field = root.getFields()[node.name.value];
        const expected = write
          ? 'record-write'
          : api === 'metadata'
            ? 'metadata-read'
            : 'record-read';
        if (!field || field.extensions[COMPANY_EDITOR_CAPABILITY] !== expected)
          throw new CompanyBrowserError(403);
      } else if (node.kind === Kind.INLINE_FRAGMENT) {
        inspect(node.selectionSet, ancestors);
      } else {
        const name = node.name.value;
        const fragment = fragments.get(name);
        if (!fragment || ancestors.has(name))
          throw new CompanyBrowserError(403);
        inspect(fragment.selectionSet, new Set([...ancestors, name]));
      }
    }
  };
  inspect(operation.selectionSet, new Set());
  if (fields === 0) throw new CompanyBrowserError(403);
  return write ? 'write' : 'read';
};
