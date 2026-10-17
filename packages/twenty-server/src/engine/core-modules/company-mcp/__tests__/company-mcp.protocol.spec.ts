import {
  COMPANY_READ_TOOLS,
  CompanyProtocolError,
  companyToolRead,
  parseCompanyRpc,
} from '../company-mcp.protocol';

const rpc = (value: unknown) =>
  parseCompanyRpc(Buffer.from(JSON.stringify(value)));
const id = '00000000-0000-4000-8000-000000000001';

describe('finite company MCP protocol', () => {
  it('publishes exactly four read tools with no selectors or writes', () => {
    expect(COMPANY_READ_TOOLS.map((tool) => tool.name)).toEqual([
      'people_list',
      'person_get',
      'customers_list',
      'customer_get',
    ]);
    for (const tool of COMPANY_READ_TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });
  it.each(['people_list', 'customers_list'])(
    'dispatches bounded %s',
    (name) => {
      expect(companyToolRead({ name, arguments: { limit: 100 } })).toEqual({
        object: name === 'people_list' ? 'people' : 'companies',
        limit: 100,
      });
    },
  );
  it.each(['person_get', 'customer_get'])('dispatches canonical %s', (name) => {
    expect(companyToolRead({ name, arguments: { id } }).id).toBe(id);
  });
  it.each([0, 101, -1, 1.5, '1', null, true, [], {}])(
    'denies malformed limit %j',
    (limit) => {
      expect(() =>
        companyToolRead({ name: 'people_list', arguments: { limit } }),
      ).toThrow();
    },
  );
  it.each([
    'company_id',
    'subject_id',
    'workspace_id',
    'audience',
    'scope',
    'fields',
    'filter',
    'upstream',
    '__proto__',
  ])('denies %s selectors', (selector) => {
    const args = JSON.parse(`{"limit":1,"${selector}":"foreign"}`);
    expect(() =>
      companyToolRead({ name: 'people_list', arguments: args }),
    ).toThrow();
  });
  it.each([
    undefined,
    '',
    id.toUpperCase().replace('00000000', 'AAAAAAAA'),
    '../record',
    'https://foreign.test',
    [],
    null,
  ])('denies malformed native record %j', (record) => {
    expect(() =>
      companyToolRead({ name: 'person_get', arguments: { id: record } }),
    ).toThrow();
  });
  it.each([
    'execute_tool',
    'http_request',
    'people_create',
    'import',
    'export',
    'people_list/../write',
  ])('denies unknown tool %s', (name) => {
    expect(() => companyToolRead({ name, arguments: { limit: 1 } })).toThrow();
  });
  it('parses one bounded request with primitive ID', () => {
    expect(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).id).toBe(1);
  });
  it.each([
    '[{"jsonrpc":"2.0","id":1,"method":"ping"}]',
    '{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"people_list","arguments":{"limit":1,"limit":2}}}',
    '{"jsonrpc":"2.0","\\u0069d":1,"method":"ping"}',
    '{"jsonrpc":"2.0","id":null,"method":"ping"}',
    '{"jsonrpc":"2.0","id":[],"method":"ping"}',
    '{"jsonrpc":"2.0","id":1,"method":"ping","company_id":"foreign"}',
    '{"jsonrpc":"2.0","id":1,"method":"ping"}true',
    '{"jsonrpc":"2.0","id":1,"method":"ping","params":[]}',
  ])('denies ambiguous/malformed raw request %s', (raw) => {
    expect(() => parseCompanyRpc(Buffer.from(raw))).toThrow();
  });
  it('denies invalid UTF8, oversized and excessive nesting', () => {
    expect(() => parseCompanyRpc(Buffer.from([0xff]))).toThrow();
    expect(() => parseCompanyRpc(Buffer.alloc(8193, 32))).toThrow();
    expect(() =>
      rpc({
        jsonrpc: '2.0',
        method: 'ping',
        id: 1,
        params: { nested: [[[[[[[[[[1]]]]]]]]]] },
      }),
    ).toThrow();
  });
});

it.each(['\ufeff', '\u00a0'])(
  'rejects non-JSON whitespace as a protocol error',
  (whitespace) => {
    const message = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    for (const raw of [
      whitespace + message,
      message + whitespace,
      message.replace(':1', ':' + whitespace + '1'),
    ])
      expect(() => parseCompanyRpc(Buffer.from(raw))).toThrow(
        CompanyProtocolError,
      );
  },
);
