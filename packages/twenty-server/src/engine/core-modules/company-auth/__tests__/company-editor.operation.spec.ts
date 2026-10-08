import {
  execute,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse,
} from 'graphql';

import {
  COMPANY_EDITOR_CAPABILITY,
  companyEditorOperation,
} from '../company-editor.operation';

describe('native company editor operation boundary', () => {
  const called = jest.fn(() => 'native record');
  const field = (capability?: string) => ({
    type: GraphQLString,
    resolve: called,
    extensions: capability ? { [COMPANY_EDITOR_CAPABILITY]: capability } : {},
  });
  const records = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        person: field('record-read'),
        workspaceMember: field(),
        auth: field(),
      },
    }),
    mutation: new GraphQLObjectType({
      name: 'Mutation',
      fields: { createPerson: field('record-write'), setRole: field() },
    }),
  });
  const metadata = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: { currentUser: field('metadata-read'), login: field() },
    }),
    mutation: new GraphQLObjectType({
      name: 'Mutation',
      fields: { setRole: field('metadata-read') },
    }),
  });

  beforeEach(() => called.mockClear());

  it('executes the actual native field behind aliases and fragments', async () => {
    const document = parse(
      'query Editor { ...Safe } fragment Safe on Query { contact: person }',
    );
    expect(companyEditorOperation(records, document, 'Editor', 'records')).toBe(
      'read',
    );
    const result = await execute({
      schema: records,
      document,
      operationName: 'Editor',
    });
    expect(result.data).toEqual({ contact: 'native record' });
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('classifies native record mutations separately from metadata queries', () => {
    expect(
      companyEditorOperation(
        records,
        parse('mutation { createPerson }'),
        undefined,
        'records',
      ),
    ).toBe('write');
    expect(
      companyEditorOperation(
        metadata,
        parse('{ currentUser }'),
        undefined,
        'metadata',
      ),
    ).toBe('read');
  });

  it.each([
    '{ person auth }',
    '{ person workspaceMember }',
    '{ person ...Unsafe } fragment Unsafe on Query { allowed: auth }',
    'mutation { createPerson setRole }',
    'query Safe { person } mutation Unsafe { createPerson }',
    'subscription { person }',
    '{ __schema { queryType { name } } }',
    '{ ...Loop } fragment Loop on Query { person ...Loop }',
  ])('refuses %s before any native resolver executes', (query) => {
    expect(() =>
      companyEditorOperation(records, parse(query), undefined, 'records'),
    ).toThrow();
    expect(called).not.toHaveBeenCalled();
  });

  it('cannot obtain permission by spoofing operationName or API kind', () => {
    expect(() =>
      companyEditorOperation(
        records,
        parse('query Unsafe { auth }'),
        'Safe',
        'records',
      ),
    ).toThrow();
    expect(() =>
      companyEditorOperation(
        records,
        parse('query Safe { person }'),
        'Unsafe',
        'records',
      ),
    ).toThrow();
    expect(() =>
      companyEditorOperation(
        metadata,
        parse('mutation { setRole }'),
        undefined,
        'metadata',
      ),
    ).toThrow();
    expect(() =>
      companyEditorOperation(
        records,
        parse('{ person }'),
        undefined,
        'metadata',
      ),
    ).toThrow();
    expect(called).not.toHaveBeenCalled();
  });
});
