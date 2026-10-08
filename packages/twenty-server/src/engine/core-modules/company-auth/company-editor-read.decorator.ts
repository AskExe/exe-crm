import { Extensions } from '@nestjs/graphql';

import { COMPANY_EDITOR_CAPABILITY } from './company-editor.operation';

// A native read resolver opts in at its schema boundary; URL/operation names
// and general public/settings permission markers do not confer this capability.
export const CompanyEditorRead = (): MethodDecorator =>
  Extensions({ [COMPANY_EDITOR_CAPABILITY]: 'metadata-read' });
