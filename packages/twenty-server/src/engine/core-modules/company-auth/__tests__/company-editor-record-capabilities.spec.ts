import { buildSchema, parse } from 'graphql';

import { markCompanyEditorRecords } from '../company-editor-record-capabilities';
import { companyEditorOperation } from '../company-editor.operation';

describe('native generated record capabilities', () => {
  it('admits business CRUD from actual generated field identities but never protected/system objects', () => {
    const names = [
      'person',
      'workspaceMember',
      'user',
      'role',
      'workspace',
      'application',
      'token',
      'systemRecord',
    ];
    const schema = buildSchema(
      `type Query { ${names.map((name) => `${name}s: String`).join(' ')} } type Mutation { ${names.map((name) => `create${name[0].toUpperCase() + name.slice(1)}: String`).join(' ')} }`,
    );
    const nativeMaps = {
      byUniversalIdentifier: Object.fromEntries(
        names.map((name) => [
          name,
          {
            nameSingular: name,
            namePlural: name + 's',
            isSystem: name === 'systemRecord',
          },
        ]),
      ),
      universalIdentifierById: Object.fromEntries(
        names.map((name) => ['id-' + name, name]),
      ),
      universalIdentifiersByApplicationId: { app: names },
    };
    markCompanyEditorRecords(schema, nativeMaps);
    expect(
      companyEditorOperation(
        schema,
        parse('mutation { createPerson }'),
        undefined,
        'records',
      ),
    ).toBe('write');
    expect(
      companyEditorOperation(
        schema,
        parse('{ people: persons }'),
        undefined,
        'records',
      ),
    ).toBe('read');
    for (const name of names.slice(1)) {
      expect(() =>
        companyEditorOperation(
          schema,
          parse(`mutation { create${name[0].toUpperCase() + name.slice(1)} }`),
          undefined,
          'records',
        ),
      ).toThrow();
      expect(() =>
        companyEditorOperation(
          schema,
          parse(`{ persons ${name}s }`),
          undefined,
          'records',
        ),
      ).toThrow();
    }
  });
});
