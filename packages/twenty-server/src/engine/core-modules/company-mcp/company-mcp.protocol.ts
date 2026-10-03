import { COMPANY_UUID } from 'src/engine/core-modules/company-auth/company-auth.config';

export const COMPANY_MCP_VERSION = '2025-11-25';
export const COMPANY_MCP_BODY_BYTES = 8192;
export const COMPANY_MCP_RESULT_BYTES = 262144;
export const COMPANY_MCP_DEADLINE_MS = 15000;
export type CompanyRead = {
  object: 'people' | 'companies';
  limit: number;
  id?: string;
};
export type CompanyRpc = {
  jsonrpc: '2.0';
  method: string;
  id?: string | number;
  params?: Record<string, unknown>;
};
export class CompanyProtocolError extends Error {
  constructor(readonly code = -32600) {
    super('Invalid company request');
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).every((name) => names.includes(name));
export const companyRpcIdentifier = (
  value: unknown,
): value is string | number =>
  (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);

// The raw parser denies duplicate/escaped keys before native JSON parsing can
// erase ambiguity. No caller object is merged into native request/auth context.
export const parseCompanyRpc = (raw: Buffer): CompanyRpc => {
  if (!Buffer.isBuffer(raw) || raw.length > COMPANY_MCP_BODY_BYTES)
    throw new CompanyProtocolError();
  const text = raw.toString('utf8');
  if (!Buffer.from(text).equals(raw)) throw new CompanyProtocolError();
  let at = 0;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(text[at] ?? '') && at < text.length) at++;
  };
  const string = (): string => {
    const match =
      /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(
        text.slice(at),
      );
    if (!match) throw new CompanyProtocolError();
    at += match[0].length;
    return match[0];
  };
  const value = (depth: number): void => {
    if (depth > 8) throw new CompanyProtocolError();
    whitespace();
    if (text[at] === '{') {
      at++;
      whitespace();
      const names = new Set<string>();
      if (text[at] === '}') {
        at++;
        return;
      }
      for (;;) {
        whitespace();
        const key = string();
        if (key.includes('\\') || names.has(key))
          throw new CompanyProtocolError();
        names.add(key);
        whitespace();
        if (text[at++] !== ':') throw new CompanyProtocolError();
        value(depth + 1);
        whitespace();
        const next = text[at++];
        if (next === '}') return;
        if (next !== ',') throw new CompanyProtocolError();
      }
    }
    if (text[at] === '[') {
      at++;
      whitespace();
      if (text[at] === ']') {
        at++;
        return;
      }
      for (;;) {
        value(depth + 1);
        whitespace();
        const next = text[at++];
        if (next === ']') return;
        if (next !== ',') throw new CompanyProtocolError();
      }
    }
    if (text[at] === '"') {
      string();
      return;
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        text.slice(at),
      );
    if (!match) throw new CompanyProtocolError();
    at += match[0].length;
  };
  value(0);
  whitespace();
  if (at !== text.length) throw new CompanyProtocolError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CompanyProtocolError();
  }
  if (
    !object(parsed) ||
    !exact(parsed, ['jsonrpc', 'method', 'id', 'params']) ||
    parsed.jsonrpc !== '2.0' ||
    typeof parsed.method !== 'string' ||
    parsed.method.length > 64 ||
    (Object.prototype.hasOwnProperty.call(parsed, 'id') &&
      !companyRpcIdentifier(parsed.id)) ||
    (Object.prototype.hasOwnProperty.call(parsed, 'params') &&
      !object(parsed.params))
  )
    throw new CompanyProtocolError();
  return parsed as CompanyRpc;
};

export const companyToolRead = (
  params: Record<string, unknown> | undefined,
): CompanyRead => {
  if (
    !params ||
    !exact(params, ['name', 'arguments']) ||
    typeof params.name !== 'string' ||
    !object(params.arguments)
  )
    throw new CompanyProtocolError(-32602);
  const list =
    params.name === 'people_list' || params.name === 'customers_list';
  const single = params.name === 'person_get' || params.name === 'customer_get';
  const args = params.arguments;
  if (
    (!list && !single) ||
    !exact(args, list ? ['limit'] : ['id']) ||
    (list &&
      (typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 100)) ||
    (single && (typeof args.id !== 'string' || !COMPANY_UUID.test(args.id)))
  )
    throw new CompanyProtocolError(-32602);
  return {
    object:
      params.name.startsWith('person') || params.name.startsWith('people')
        ? 'people'
        : 'companies',
    limit: list ? (args.limit as number) : 1,
    ...(single ? { id: args.id as string } : {}),
  };
};

export const COMPANY_READ_TOOLS = [
  'people_list',
  'person_get',
  'customers_list',
  'customer_get',
].map((name) => ({
  name,
  description: name.includes('list')
    ? 'Read a bounded native-permitted record list.'
    : 'Read one native-permitted record.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: name.includes('list')
      ? { limit: { type: 'integer', minimum: 1, maximum: 100 } }
      : { id: { type: 'string', pattern: COMPANY_UUID.source } },
    required: [name.includes('list') ? 'limit' : 'id'],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}));
