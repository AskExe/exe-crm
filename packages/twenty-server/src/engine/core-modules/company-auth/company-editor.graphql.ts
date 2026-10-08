import { type Plugin } from 'graphql-yoga';

import { CompanyBrowserError } from './company-browser.protocol';
import { companyEditorEnabled } from './company-editor.config';
import { companyEditorOperation } from './company-editor.operation';

export const useCompanyEditorBoundary = (
  api: 'records' | 'metadata',
): Plugin => ({
  onExecute: ({ args }) => {
    if (!companyEditorEnabled()) return;
    companyEditorOperation(
      args.schema,
      args.document,
      args.operationName ?? undefined,
      api,
    );
  },
  onSubscribe: () => {
    if (companyEditorEnabled()) throw new CompanyBrowserError(403);
  },
});
