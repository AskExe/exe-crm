import { type GraphQLSchema } from 'graphql';

import { workspaceResolverBuilderMethodNames } from 'src/engine/api/graphql/workspace-resolver-builder/factories/factories';
import { getResolverName } from 'src/engine/utils/get-resolver-name.util';

import { COMPANY_EDITOR_CAPABILITY } from './company-editor.operation';

import {
  companyEditorRecordAllowed,
  type RecordIdentity,
} from './company-editor-record-identity';

export const markCompanyEditorRecords = (
  schema: GraphQLSchema,
  objects: { byUniversalIdentifier: Partial<Record<string, RecordIdentity>> },
) => {
  for (const object of Object.values(objects.byUniversalIdentifier)) {
    if (!object || !companyEditorRecordAllowed(object)) continue;
    for (const method of workspaceResolverBuilderMethodNames.queries) {
      const field = schema.getQueryType()?.getFields()[
        getResolverName(object, method)
      ];
      if (field)
        field.extensions = {
          ...field.extensions,
          [COMPANY_EDITOR_CAPABILITY]: 'record-read',
        };
    }
    for (const method of workspaceResolverBuilderMethodNames.mutations) {
      const field = schema.getMutationType()?.getFields()[
        getResolverName(object, method)
      ];
      if (field)
        field.extensions = {
          ...field.extensions,
          [COMPANY_EDITOR_CAPABILITY]: 'record-write',
        };
    }
  }
};
