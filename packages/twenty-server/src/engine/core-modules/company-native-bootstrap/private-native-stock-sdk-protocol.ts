export const STOCK_SDK_MAX_SCHEMA_BYTES = 2 * 1024 * 1024;
export const STOCK_SDK_MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
export const STOCK_SDK_MAX_REQUEST_BYTES =
  6 * STOCK_SDK_MAX_SCHEMA_BYTES + 1024;
export const STOCK_SDK_MAX_RESULT_BYTES = 24 * 1024 * 1024;

export type PrivateStockSdkRequest = Readonly<{
  version: 1;
  actionId: string;
  workspaceId: string;
  applicationId: string;
  applicationUniversalIdentifier: string;
  schema: string;
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEYS = [
  'actionId',
  'applicationId',
  'applicationUniversalIdentifier',
  'schema',
  'version',
  'workspaceId',
];

// These identifiers are echoes, not worker authority. The parent independently
// derives and checks the entire tuple under its original issued action fence.
export const decodePrivateStockSdkRequest = (
  bytes: Buffer,
): PrivateStockSdkRequest => {
  if (bytes.length > STOCK_SDK_MAX_REQUEST_BYTES)
    throw new Error('stock_sdk_request_bound');
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('stock_sdk_request_shape');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== KEYS.join(',') ||
    row.version !== 1 ||
    ![
      'actionId',
      'workspaceId',
      'applicationId',
      'applicationUniversalIdentifier',
    ].every((key) => typeof row[key] === 'string' && UUID.test(row[key])) ||
    typeof row.schema !== 'string' ||
    !row.schema.length ||
    Buffer.byteLength(row.schema) > STOCK_SDK_MAX_SCHEMA_BYTES ||
    row.schema.includes('\0')
  )
    throw new Error('stock_sdk_request_shape');
  return Object.freeze(row) as PrivateStockSdkRequest;
};
